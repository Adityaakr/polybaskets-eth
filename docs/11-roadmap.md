# 11 — Roadmap

Phased so each milestone is independently verifiable. **Every phase is additive** — the live Vara
app stays untouched throughout.

## Phase 0 — Spikes (de-risk the unknowns) ~2–3 days
Resolve the items that block contract API design before writing the real contract:
- [ ] **wVARA deposit/withdraw spike** — confirm the exact `@vara-eth/api` wVARA pull/egress
      mechanism (approve+transfer_from vs transfer-to-Mirror) against the `vault`/`escrow` examples.
- [ ] **Injected vs value spike** — confirm injected rejects value and the classic-with-value deposit
      path works on Hoodi (reproduce with a throwaway program).
- [ ] **Privy → @vara-eth/api spike** — embedded wallet → EIP-1193 → viem → `walletClientToSigner` →
      one injected write end to end on Hoodi.
- [ ] **Polymarket World Cup data spike** — resolve the FIFA World Cup tag id, the winner market
      slug, and the price-history endpoint shape.

Exit: a one-page findings note pinning the contract method signatures and the data fetchers.

## Phase 1 — Contract ~3–5 days
- [ ] Author `BasketMarket` Sails program with the collateral ledger + deposit/withdraw/bet/claim/
      settlement methods ([04-contracts.md](./04-contracts.md)).
- [ ] `gtest` coverage (deposit/bet/claim/withdraw/settlement edge cases).
- [ ] Build `.opt.wasm` + IDL; `cargo sails idl --program-name BasketMarket`.
- [ ] Deploy to Hoodi via ethexe (upload→validate→create→top-up→init→smoke read).

Exit: program live on Hoodi, smoke reads green, IDL committed to `app/public/`.

## Phase 2 — Interaction layer ~3–4 days
- [ ] `src/lib/varaeth/*` — session (Privy), api, idl codec, basketMarket, ledger, injected, classic.
- [ ] Port proven encode/decode + reply-listener logic from the parent `varaEthBasketClient.ts`.
- [ ] Headless test script: deposit → create → bet → read → (settle) → claim → withdraw on Hoodi.

Exit: full lifecycle works from a script, no UI.

## Phase 3 — Frontend core ~5–7 days
- [ ] Vite app scaffold + Privy provider + design tokens (copy PolyBaskets `:root`).
- [ ] Copy & wire `polymarket.ts`, `basket-utils.ts`, `betCalculator.ts` + `worldCup.ts` curation.
- [ ] Pages: Explore, Builder (slip builder + multi-select tray), Basket (expandable position cards),
      Wallet (deposit/withdraw ETH+wVARA), MyBaskets, Claim.
- [ ] Tx-state machine UX (signing → pre-confirm → confirmed) per [05](./05-wallet-and-tx-flow.md).

Exit: a user can log in with email, deposit, build a slip, bet (gasless), and claim — on Hoodi.

## Phase 4 — Polish & World Cup hero ~4–5 days
- [ ] Implement the slip/live-slip/cash-out card system + Polymarket-style market detail (chart +
      ranked candidates + related) per [07-design-system.md](./07-design-system.md).
- [ ] World Cup hero module (winner odds + match-market legs).
- [ ] Entrance/number-roll animations, reduced-motion, run `design-review` + `frontend-design-guidelines`.

Exit: the polished, card-based, World-Cup-led experience.

## Phase 5 — Settler & deploy ~2–3 days
- [ ] Fork settler bot with Vara.eth adapter ([09](./09-settlement-and-bot.md)); operator top-up job.
- [ ] Deploy frontend (Railway / subdomain e.g. `eth.polybaskets.xyz`).
- [ ] End-to-end on Hoodi: real settlement of a resolved (test) basket.

Exit: independently deployed Vara.eth site running alongside the live Vara app.

## Cross-cutting
- Keep `cargo test` / `npm run check` green per phase (skills validation rule).
- Verify **observable state**, not just submitted txs.
- Don't silently cap coverage — log what's deferred.

> Estimates assume one builder; spikes (Phase 0) gate everything and should not be skipped.
