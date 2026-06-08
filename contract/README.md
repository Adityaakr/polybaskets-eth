# BasketMarket — PolyBaskets-ETH (Vara.eth / ethexe)

A fresh `BasketMarket` Sails program for **Vara.eth (Gear ethexe)**, adapted from the live Vara
program's basket/settlement logic and extended with a **multi-collateral internal ledger** plus an
**operator-seeded house pool** economic model.

- Spec: [`../docs/04-contracts.md`](../docs/04-contracts.md),
  [`../docs/03-value-collateral-and-deposits.md`](../docs/03-value-collateral-and-deposits.md).
- Built against `sails-rs = "1.0.0-beta.3"` with the `ethexe` feature, mirroring the known-good
  `vault` / `escrow` Vara.eth examples.

## Economic model: operator-seeded house pool

- **Internal ledger** — per-user free balance per collateral: `ledger[(user, Collateral)]`.
  Depositing credits it; betting debits it; claiming credits it; withdrawing debits it and releases
  real value.
- **House pool per collateral** — `pool[Collateral]`, seeded by the operator. On `Claim`:
  - winner (`payout > shares`): net winnings `payout - shares` are paid **out of** the pool
    (guarded by `Error::PoolInsufficient`);
  - loser (`payout < shares`, incl. total loss `payout == 0`): the net loss `shares - payout` flows
    **into** the pool.
  The staked `shares` are debited from the ledger at bet time, so the pool only ever covers the net
  delta.

Payout formula (per-position, collateral-agnostic, carried over from the live program):

```
payout = shares * settlement_index_bps / index_at_creation_bps   // checked mul/div
                                                                 // index_at_creation_bps == 0 → payout = shares
```

## Workspace layout

```
contract/
├── Cargo.toml              # workspace + top crate (builds WASM + IDL)
├── rust-toolchain.toml     # stable + wasm32v1-none / wasm32-unknown-unknown
├── build.rs                # build_wasm + ClientBuilder → basket_market.idl
├── src/lib.rs              # WASM_BINARY re-export shim
├── app/                    # basket-market-app — the program logic (#[program] / #[service])
│   └── src/lib.rs
├── client/                 # basket-market-client — generated Rust client (used by gtest)
│   ├── build.rs            # build_client::<Program>()
│   ├── src/lib.rs          # includes the generated basket_market_client.rs
│   ├── src/basket_market_client.rs   # generated (DO NOT EDIT)
│   └── basket_market_client.idl      # generated IDL snapshot
└── tests/gtest.rs          # gtest coverage
```

## ABI surface note (important)

On the ethexe **Solidity ABI path** every exported parameter/return type must implement
`alloy_sol_types::SolValue`. Arbitrary SCALE structs/enums do **not**, and there is no
`#[derive(SolValue)]`. To keep the rich domain model while staying ABI-safe:

- enum discriminants cross the boundary as `u16` — `Collateral` (`0 = Eth`, `1 = Wvara`),
  `Outcome`;
- complex aggregates cross the boundary as **SCALE-encoded `Vec<u8>` blobs** — `Vec<BasketItem>`
  (input to `CreateBasket`), `Vec<Outcome>` (input to `ProposeSettlement`), and the outputs of
  `GetBasket` (`Basket`), `GetPositions` (`Vec<Position>`), `GetSettlement` (`Option<Settlement>`),
  `GetBalances` (`Vec<(Collateral, u128)>`), `GetConfig` (`Config`).

The frontend (sails-js / SCALE) encodes inputs and decodes outputs using the exact same type
definitions exported from `basket-market-app`, so no fidelity is lost. `Vec<u8>` and `String` are
confirmed-working on the current ethexe Solidity generation path; `u8` is not (hence `u16`).

The constructor is named **`Init`** (not `New`) because `new` is a reserved word on the Solidity
ABI path.

## Public API (see `client/basket_market_client.idl` for the full IDL)

Constructor: `Init(settler_role: ActorId, liveness_seconds: u64)` — `owner = msg::source()`.

| Method | Path | Notes |
|--------|------|-------|
| `CreateBasket(name, description, items: [u8])` | injected | `items` = SCALE `Vec<BasketItem>` |
| `BetOnBasket(basket_id, collateral: u16, amount, index_at_creation_bps)` | injected | debits ledger, mints shares |
| `Claim(basket_id)` | injected | credits ledger; reconciles pool |
| `DepositEth()` *(payable)* | classic | credits `ledger[(src, Eth)]` |
| `DepositWvara(amount)` | classic | credits `ledger[(src, Wvara)]` — see TODO(verify) |
| `WithdrawEth(amount)` *(returns value)* | classic | debits ledger, ETH egress via reply |
| `WithdrawWvara(amount)` | classic | debits ledger — see TODO(verify) |
| `SeedPoolEth()` *(payable, owner)* | classic | `pool[Eth] += value` |
| `SeedPoolWvara(amount)` *(owner)* | classic | `pool[Wvara] += amount` — see TODO(verify) |
| `WithdrawPoolEth(amount)` *(returns value, owner)* | classic | ETH egress via reply |
| `WithdrawPoolWvara(amount)` *(owner)* | classic | see TODO(verify) |
| `ProposeSettlement(basket_id, item_resolutions: [u8], index_bps)` *(settler)* | injected | opens challenge window |
| `FinalizeSettlement(basket_id)` *(settler)* | injected | after `challenge_deadline` |
| `GetBasket / GetBasketCount / GetPositions / GetSettlement / GetBalance / GetBalances / GetPool / GetConfig` | query | free reads |

## Build

```bash
cd polybaskets-eth/contract
cargo build --release
```

Artifacts (the gear/ethexe wasm target is built automatically by `build.rs`):

```
target/wasm32-gear/release/basket_market.opt.wasm   # upload this
target/wasm32-gear/release/basket_market.wasm
target/wasm32-gear/release/basket_market.idl        # client/frontend IDL
```

Regenerate the IDL with a parser-friendly program name if needed:

```bash
cargo sails idl --program-name BasketMarket
```

(Optional) generate the Solidity ABI interface:

```bash
cargo sails sol --idl-path target/wasm32-gear/release/basket_market.idl
```

## Test

```bash
cargo test --release
```

Covers: config/constructor, deposit credits ledger (ETH + wVARA), create-basket validation,
bet debits ledger & mints shares + insufficient-balance guard, winner paid from pool, loser stake
into pool, pool-insufficient guard, double-claim rejected, withdraw debits & egresses, settlement
challenge-window enforcement, unauthorized settler/operator rejected. **9/9 passing.**

## Deploy lifecycle (ethexe CLI)

```bash
# 1. build → target/wasm32-gear/release/basket_market.opt.wasm + .idl

# 2. upload + validate (capture CODE_ID)
ethexe --cfg none tx --ethereum-rpc $ETH_RPC --ethereum-router $ROUTER --sender $SENDER \
  upload target/wasm32-gear/release/basket_market.opt.wasm --watch --json

# 3. create program (capture PROGRAM_ID = actor_id)
ethexe --cfg none tx ... create $CODE_ID --json

# 4. fund executable balance (operator pays → enables gasless user UX)
ethexe --cfg none tx ... executable-balance-top-up $PROGRAM_ID "10000 WVARA" --approve --watch --json

# 5. initialize (Init payload encoded from the IDL — never hand-encode)
#    Init(settler_role: ActorId, liveness_seconds: u64)
ethexe --cfg none tx ... send-message $PROGRAM_ID $INIT_PAYLOAD 0 --watch --json

# 6. seed the house pool (operator). ETH via payable value:
ethexe --cfg none tx ... send-message $PROGRAM_ID $SEED_POOL_ETH_PAYLOAD <value-wei> --watch --json

# 7. smoke read: GetConfig / GetBasketCount / GetPool to prove logical readiness
```

## TODO(verify) items flagged in the code

These are deployment-blocking spikes for the value-movement paths; the contract compiles, passes
gtest, and is logically complete, but the exact ethexe value primitives need to be pinned against the
live `@vara-eth/api` / ethexe semantics before mainnet use. Tracked in
[`../docs/12-open-questions.md`](../docs/12-open-questions.md).

1. **wVARA pull mechanism** (`deposit_wvara`, `seed_pool_wvara`).
   wVARA is an ERC-20 on the Ethereum side. The exact cross-contract pull from inside an ethexe
   program is not exercised by the vault/escrow examples and has no stable in-program syscall in
   `sails-rs 1.0.0-beta.3`. Candidates: (a) user `approve(programMirror)` + program-side
   `transfer_from` (credit only on success, failure → `Error::WvaraTransferFailed`); or (b)
   transfer-to-Mirror first, then credit from received balance. Current code credits the ledger
   optimistically assuming the off-chain caller flow performs the pull.

2. **wVARA egress primitive** (`withdraw_wvara`, `withdraw_pool_wvara`).
   Counterpart of (1): the in-program wVARA transfer-to-user. Most likely a cross-program
   `wVARA.transfer(user, amount)` whose failed reply maps to `Error::WvaraTransferFailed`. Current
   code debits the ledger; wire the actual transfer once pinned.

3. **ETH egress primitive** (`withdraw_eth`, `withdraw_pool_eth`).
   Implemented with `CommandReply::new(()).with_value(amount)` — the value-returning reply pattern
   proven by the vault example's `withdraw`. This pays the **message source**. If a different ethexe
   egress primitive is required to pay an arbitrary recipient, revisit.

## License

MIT.
