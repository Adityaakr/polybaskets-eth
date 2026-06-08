# 12 — Open Questions

Things to resolve before or during the build. Grouped by urgency.

## Blocking (resolve in Phase 0 spikes)

1. **wVARA deposit/withdraw mechanism** — exact `@vara-eth/api` surface for pulling wVARA into a
   program and egressing it back. Candidates: (a) `wvara.approve(programMirror)` + program-side
   `transfer_from`; (b) transfer-to-Mirror + claim. Pins the `DepositWvara`/`WithdrawWvara` API.
   → [03](./03-value-collateral-and-deposits.md), [04](./04-contracts.md)

2. **Native ETH egress (withdraw)** — confirm the program→user ETH value-transfer primitive on
   Vara.eth (the `escrow` `release`/`claim` pattern). Needed for `WithdrawEth`.

3. **Privy + injected end-to-end** — confirm an embedded-wallet EIP-1193 provider signs an injected
   Vara.eth transaction cleanly (no chain-mismatch / signing-domain surprises). Should work since the
   stack only needs a viem `walletClient`, but verify on Hoodi.

4. **Polymarket World Cup data** — the FIFA World Cup tag id, the canonical winner-market slug, and
   the price-history endpoint shape. → [08](./08-polymarket-reuse.md)

5. **Correct Router address** for the target network — do not trust stale `.env.example`. Wrong
   Router silently attaches to wrong state.

## Product / economics

6. **Payout funding / solvency** — ✅ **DECIDED (2026-06-07): operator-seeded house pool.** The
   operator seeds a **pool per collateral** (ETH pool, wVARA pool). Losers' staked amounts flow into
   the pool; winners are paid out of the pool. The contract tracks a `pool` balance per collateral,
   exposes `SeedPool` (operator-only, payable) and `WithdrawPool` (operator-only), and on claim pays
   `payout` from the pool (capped at pool balance — see solvency guard in
   [03](./03-value-collateral-and-deposits.md) and [04](./04-contracts.md)).

7. **Cash out (pre-settlement exit)** — the reference mockups show "Cash out" / "Slip value now".
   That requires a secondary-market or buyback mechanism. v1 likely ships **claim-after-settlement
   only**, with cash-out as "coming soon." Decide whether v1 needs it. → [07](./07-design-system.md)

8. **ETH/USD price source** — bet sizing converts USD→collateral. wVARA/USD reuses the existing
   reference; ETH/USD needs an oracle or config feed. Which source?

9. **Multi-collateral per basket** — allowed by the math, but do we *want* users mixing ETH and wVARA
   bets in one basket, or pick one collateral per basket for clarity? UX call.

## Ops / infra

10. **Contract & settler location** — fork into `polybaskets-eth/contract` + `polybaskets-eth/settler`
    (recommended, strictly additive) vs reuse parent dirs. → [02](./02-architecture.md), [09](./09-settlement-and-bot.md)

11. **Executable-balance top-up operator** — who/what keeps the program funded so user actions stay
    "gasless"? Needs a funded operator key + a monitoring/top-up job + budget.

12. **Deploy surface** — `eth.polybaskets.xyz` subdomain vs `app.polybaskets.xyz/eth` path. Affects
    routing, Privy allowed origins, CORS proxy.

13. **Testnet vs mainnet** — plan targets Hoodi testnet. When is there a Vara.eth mainnet target, and
    does real-value betting wait for it? (The brief said "Ethereum live mandate" — clarify timeline.)

## Smaller

14. Privy login methods to enable (email + which socials + external wallets).
15. Whether to share a component library with the parent app later (keeping v1 copied/independent).
16. Indexer: reuse the parent's GraphQL indexer for Vara.eth events, or read on-chain directly in v1?
