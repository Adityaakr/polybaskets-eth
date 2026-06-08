# 03 — Value, Collateral & Deposits (in depth)

This is the heart of PolyBaskets-ETH. It explains how money moves when both **native ETH** and
**wVARA** are accepted as collateral, while keeping create/bet/claim on the fast injected path.

## The core idea: separate *value movement* from *gameplay*

Vara.eth injected transactions **cannot carry ETH value**. If bets carried value, every bet would be
a gas-paying L1 transaction — slow and not gasless. So we split the system in two:

```
        VALUE MOVEMENT (rare, value-carrying, gas, L1-settled)
        ─────────────────────────────────────────────────────
        Deposit ETH ─┐                          ┌─ Withdraw ETH
        Deposit wVARA┘──►  INTERNAL LEDGER  ◄──┘─ Withdraw wVARA
                              │   ▲
                              │   │  (debit on bet, credit on claim)
                              ▼   │
        GAMEPLAY (frequent, zero-value, injected, pre-confirmed, gasless-feeling)
        ─────────────────────────────────────────────────────────────────────
        Create basket · Place bet · Claim payout → balance
```

The **internal ledger** is a balance sheet inside the BasketMarket program. Depositing credits it;
betting debits it; claiming credits it; withdrawing debits it and releases real value. Because bets
and claims only move *ledger* numbers (not ETH value), they qualify for injected pre-confirmation.

## Collateral types

```rust
enum Collateral {
    Eth,    // native ETH, 18 decimals
    Wvara,  // wrapped VARA (ERC-20 on Ethereum side), 12 decimals
}
```

The ledger is keyed per user **per collateral** — balances never mix across asset types:

```rust
// inside BasketMarket state
ledger: HashMap<(ActorId, Collateral), u128>,   // available (free) balance
locked: HashMap<(ActorId, Collateral), u128>,   // optional: reserved by open positions
```

> **Decimals discipline (a top failure mode):** ETH = 18 dec, wVARA = 12 dec. Store raw base units,
> tag every amount with its collateral, and only format at the UI edge. The existing
> `src/lib/varaEthClient.ts` already has `toWVara` / `fromWVara` (12-dec); ETH uses viem
> `parseEther` / `formatEther`.

## The four value-touching flows

### 1. Deposit ETH (value-in, classic, the user pays gas once)

Native ETH is attached as program value on a classic Mirror message:

```ts
// classic.ts — value-carrying write
const payload = program.services.BasketMarket.functions.DepositEth.encodePayload();
const tx = await mirror.sendMessage(payload, valueWei);   // ETH attached here
await tx.send();
const { waitForReply } = await tx.setupReplyListener();
const reply = await waitForReply();   // expect 0x00010000 (manual success)
```

Contract side reads the attached value and credits:

```rust
pub fn deposit_eth(&mut self) -> Result<u128, Error> {
    let user = msg::source();
    let amount = msg::value();                 // ETH attached to this message
    if amount == 0 { return Err(Error::ZeroValue); }
    *self.ledger.entry((user, Collateral::Eth)).or_default() += amount;
    Ok(self.balance_of(user, Collateral::Eth))
}
```

This is the only ETH-value-carrying user action and is proven by the `escrow` example's payable
`createOrder`. Signed as a normal Hoodi tx via Privy's `walletClient`.

### 2. Deposit wVARA (value-in)

wVARA is an ERC-20 on the Ethereum side. Depositing it as collateral is an approve + pull:

```ts
// ledger.ts
const amount = 5n * 1_000_000_000_000n;                 // 5 wVARA (12 dec)
const approveTx = await api.eth.wvara.approve(programMirror, amount);
await approveTx.sendAndWaitForReceipt();

const payload = program.services.BasketMarket.functions.DepositWvara.encodePayload(amount);
const tx = await mirror.sendMessage(payload, 0n);       // no ETH value; wVARA pulled by program
await tx.send();
const reply = await (await tx.setupReplyListener()).waitForReply();
```

```rust
pub fn deposit_wvara(&mut self, amount: u128) -> Result<u128, Error> {
    let user = msg::source();
    // Pull `amount` wVARA from user via the wVARA contract (transfer_from with prior approval).
    self.wvara_transfer_from(user, exec::program_id(), amount)?;
    *self.ledger.entry((user, Collateral::Wvara)).or_default() += amount;
    Ok(self.balance_of(user, Collateral::Wvara))
}
```

> ⚠️ **Verify before building:** the exact wVARA pull mechanism depends on the `@vara-eth/api`
> version and how wVARA is exposed to a program (the `api.eth.wvara` client surface vs an in-program
> cross-contract call). Two candidate mechanisms — (a) `approve(programMirror)` + program-side
> `transfer_from`, or (b) transfer-to-Mirror then a `DepositWvara` claim that credits from received
> balance. Pin this in a spike before committing the contract API. Tracked in
> [12-open-questions.md](./12-open-questions.md).

### 3. Bet (zero-value, injected, gasless-feeling)

The bet names the collateral and amount; the program debits the ledger and mints shares. **No value
is attached**, so it goes through `createInjectedTransaction`:

```ts
// basketMarket.ts
const payload = program.services.BasketMarket.functions.BetOnBasket.encodePayload(
  basketId, collateral, amount, indexAtCreationBps,
);
const tx = await api.createInjectedTransaction({ destination: programId, payload, value: 0n });
const promise = await tx.sendAndWaitForPromise();   // ← pre-confirmation
await promise.validateSignature();
if (promise.code.isError) throw new Error(promise.code.reason);
```

```rust
pub fn bet_on_basket(
    &mut self, basket_id: u64, collateral: Collateral,
    amount: u128, index_at_creation_bps: u16,
) -> Result<u128, Error> {
    let user = msg::source();
    let bal = self.ledger.entry((user, collateral)).or_default();
    if *bal < amount { return Err(Error::InsufficientBalance); }
    *bal -= amount;                                  // debit internal balance — no ETH moves
    let shares = amount;                             // shares == staked base units (per existing model)
    self.positions.push(Position { basket_id, user, collateral, shares,
                                    index_at_creation_bps, claimed: false });
    Ok(shares)
}
```

Because betting is pure ledger arithmetic, it pre-confirms in well under a second and costs the user
nothing (the program's executable balance, topped up by the operator, pays for execution).

### 4. Claim (zero-value injected) and Withdraw (value-out, classic)

**Claim** credits winnings back to the internal ledger — still zero-value, still injected:

```rust
pub fn claim(&mut self, basket_id: u64) -> Result<u128, Error> {
    let user = msg::source();
    let settlement = self.settlement(basket_id).ok_or(Error::SettlementNotFinalized)?;
    let pos = self.position_mut(basket_id, user)?;
    if pos.claimed { return Err(Error::AlreadyClaimed); }
    // payout = shares * settlement_index_bps / index_at_creation_bps   (existing formula)
    let payout = mul_div(pos.shares, settlement.index_bps, pos.index_at_creation_bps)?;
    pos.claimed = true;
    *self.ledger.entry((user, pos.collateral)).or_default() += payout;   // credit, no value egress
    Ok(payout)
}
```

**Withdraw** is the only value-out action — it releases real ETH/wVARA, so it cannot be injected:

```ts
// withdraw ETH: classic message; the program replies with value egress through the Mirror
const payload = program.services.BasketMarket.functions.WithdrawEth.encodePayload(amount);
const tx = await mirror.sendMessage(payload, 0n);
await tx.send();
await (await tx.setupReplyListener()).waitForReply();
```

```rust
pub fn withdraw_eth(&mut self, amount: u128) -> Result<(), Error> {
    let user = msg::source();
    let bal = self.ledger.entry((user, Collateral::Eth)).or_default();
    if *bal < amount { return Err(Error::InsufficientBalance); }
    *bal -= amount;
    msg::send_with_value(user, /*payload*/ b"", amount)?;   // ETH egress to user
    Ok(())
}
```

> The exact ETH/wVARA egress primitive (program → user) is the withdraw counterpart to the deposit
> spike — verify against the `@vara-eth/api` / ethexe value-transfer semantics (the `escrow`
> `release`/`refund`/`claim` flow is the reference). Tracked in [12-open-questions.md](./12-open-questions.md).

## Why multi-collateral baskets are safe here

PolyBaskets payout is **per-position**, not a pool split:

```
payout = shares × (settlement_index_bps / index_at_creation_bps)
```

Each position's payout depends only on its own entry index and the settlement index — both
collateral-agnostic (they're derived from Polymarket probabilities, scaled 0–10000 bps). So a single
basket can accept ETH bets and wVARA bets simultaneously; each position simply settles in the
collateral it was placed with. No cross-collateral conversion is ever required on-chain.

> Implication: the program must hold enough of each collateral to cover that collateral's winning
> payouts. This is a **solvency/treasury** concern (where do payouts above stake come from?) — see
> the payout-funding question in [12-open-questions.md](./12-open-questions.md). It is identical to
> the live Vara app's existing model, just now per-collateral.

## USD ↔ collateral conversion (bet sizing)

`betCalculator.ts` sizes bets in **USD** against live Polymarket prices. To place a bet in ETH or
wVARA we convert at bet time:

- **wVARA/USD** — reuse the existing fallback/reference price approach (`betCalculator` already
  carries a `varaPriceUsd` default of `0.0015`, fed by `useVaraUsdPrice`).
- **ETH/USD** — needs a price source (oracle or config). Flagged as an open question.

The conversion is display/UX only; on-chain amounts are always raw base units of the chosen
collateral. The user sees "≈ $25.00" but stakes e.g. `0.0125 ETH`.

## State the UI must surface (per collateral)

For each user and each collateral, the wallet/deposit page shows:

| Field | Source |
|-------|--------|
| Wallet balance (ETH / wVARA on Hoodi) | viem `publicClient.getBalance` / wVARA `balanceOf` |
| Deposited (free) ledger balance | `GetBalance(user, collateral)` query |
| Locked in open positions | `GetPositions(user)` aggregated, or a `locked` query |
| Claimable from settled baskets | settlement + positions |

## Summary table

| Action | Value? | Path | Collateral handling |
|--------|--------|------|--------------------|
| Deposit ETH | in | classic + value | credit `ledger[(u, Eth)]` |
| Deposit wVARA | in | approve + classic | credit `ledger[(u, Wvara)]` |
| Create basket | no | injected | none |
| Bet | no | injected | debit `ledger[(u, c)]`, mint shares (tagged with `c`) |
| Claim | no | injected | credit `ledger[(u, c)]` by payout |
| Withdraw ETH/wVARA | out | classic | debit ledger, egress value |
