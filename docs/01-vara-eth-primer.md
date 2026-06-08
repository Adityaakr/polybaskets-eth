# 01 — Vara.eth Primer (what the team needs to know)

Distilled from `gear-foundation/vara-eth-skills`. This is the mental model the whole plan rests on.

## What Vara.eth is

Vara.eth (a.k.a. **ethexe**) lets Gear/Sails WASM programs execute off the Ethereum L1 but **settle
to Ethereum**. Each program is mirrored by an Ethereum contract. You get Sails' actor/message model
*and* Ethereum security + Ethereum wallets.

Target network for dev: **Hoodi testnet** (`chainId 560048`, hex `0x88bb0`).

## The three on-chain pieces

| Piece | What it is | Lives on |
|-------|-----------|----------|
| **Router** | One global contract that coordinates code validation, program creation, and the validator set. You point every tool at the Router address for your network. | Ethereum (Hoodi) |
| **Mirror** | Per-program Ethereum contract. One Mirror per deployed program (its address **is** the program id). Holds the program's settled state hash, executable balance, and is where classic `sendMessage` lands. | Ethereum (Hoodi) |
| **Program** | Your Sails WASM logic (the BasketMarket). Executes on Vara.eth; state settles through its Mirror. | Vara.eth |

Plus **wVARA** — a wrapped-VARA ERC-20 used to pay each program's *executable balance* (the gas the
program burns to run messages). **wVARA uses 12 decimals**, not 18. `1 wVARA = 1_000_000_000_000`.

## Three ways to talk to a program

This choice is the single most important architectural decision, so it gets its own table.

| Path | How a write happens | Carries ETH value? | UX | We use it for |
|------|--------------------|--------------------|-----|----------------|
| **Classic Mirror** | `mirror.sendMessage(payload, value)` → a *real Ethereum tx*. User pays gas, full L1 finality. | ✅ yes | Slow (block time), gas prompt | Fallback / admin / value-carrying ops |
| **Injected** | `api.createInjectedTransaction({...})` → submitted **directly into Vara.eth**, pre-confirmed by validators. | ❌ **no — rejects non-zero value** | Fast "promise", gasless-feeling | **Our hot path: create / bet / claim / claim-to-balance** |
| **Classic + value** | `mirror.sendMessage(payload, value)` with ETH attached → payable Sails handler reads `msg::value()`. | ✅ yes | Normal EVM tx, gas | **Deposit ETH** (value-in) |
| **Solidity ABI adapter** | A Solidity contract implements an ABI; calls bridge to the program via async callbacks. | ✅ (the adapter is payable) | Normal EVM tx | Optional cleaner deposit/withdraw bridge (future) |

> ### The constraint that shaped this whole plan
> **Injected transactions cannot carry ETH value.** The CLI/SDK reject a non-zero-value injected
> message. So we **separate value movement from gameplay**: users *deposit* native ETH or wVARA once
> (a value-carrying classic tx that credits an internal ledger), and then *create / bet / claim* by
> spending that internal balance through **zero-value injected** messages — fast, gasless-feeling,
> pre-confirmed. Value only re-crosses the boundary on **withdraw**. This is the deposit/credit model
> detailed in [03-value-collateral-and-deposits.md](./03-value-collateral-and-deposits.md).

## The injected write lifecycle (the core flow)

```
1. Get an EIP-1193 provider           ← Privy gives us this (embedded or external wallet)
2. viem walletClient = custom(provider)
3. signer = walletClientToSigner(walletClient)        // from "@vara-eth/api/signer"
4. api = createVaraEthApi(WsVaraEthProvider(varaEthWs), publicClient, routerAddress, signer)
5. payload = SailsProgram...encodePayload(args)        // never hand-encode
6. tx = await api.createInjectedTransaction({ destination: programId, payload, value: 0n })
7. promise = await tx.sendAndWaitForPromise()          // ← PRE-CONFIRMATION lands here
8. await promise.validateSignature()
9. if (promise.code.isError) throw ...
10. read result: api.call.program.calculateReplyForHandle(address, programId, queryPayload, 0n)
```

Steps 6–9 are the pre-confirmation. Step 10 reads confirmed state without sending any Ethereum tx.

## Reads are free and Ethereum-tx-free

Query a program's state with `api.call.program.calculateReplyForHandle(source, programId, payload, 0n)`
and decode with the matching Sails query object. No wallet signature, no gas. This is how every
"show me the basket / my positions / settlement status" read works.

## Reply codes you'll see

- `0x00000000` — success, auto reply
- `0x00010000` — success, **manual** reply (methods that return a value use this — **not** a failure)

## Operational lifecycle of a program (one-time, admin)

Done via the `ethexe` CLI (see [04-contracts.md](./04-contracts.md) and the ethexe-cli playbook):

1. `cargo build --release` → `*.opt.wasm` + `*.idl`
2. `ethexe tx ... upload <wasm> --watch` → wait for **code validation**, capture `code_id`
3. `ethexe tx ... create <code_id>` → capture `actor_id` = **PROGRAM_ID**
4. `ethexe tx ... executable-balance-top-up <PROGRAM_ID> "<amount> WVARA" --approve --watch`
5. `ethexe tx ... send-message <PROGRAM_ID> <init_payload> 0 --watch` (constructor)
6. Smoke-read a program-specific query to prove logical readiness

> **Who pays for "gasless"?** The user's injected writes still consume the *program's* executable
> balance. An **operator** keeps that balance topped up with wVARA. That's what makes the experience
> feel free to the end user. Budget for an operator top-up job.

## Failure modes to design around (from the skills error-log)

- Wrong Router address → everything "succeeds" but against the wrong network state.
- Stale `code_id` → always upload the current `.opt.wasm` for a fresh build.
- Missing executable balance → init or user messages silently fail to execute.
- Hand-encoded payloads → use the Sails IDL/`SailsProgram` to encode, always.
- Treating an Ethereum receipt as "state is visible" → poll the Vara.eth state read after.
- Treating `0x00010000` as an error → it's a success (manual reply).
