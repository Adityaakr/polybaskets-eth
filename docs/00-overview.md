# 00 — Overview & Vision

## What we're building

A **standalone PolyBaskets app that runs on Vara.eth** — the EVM-settled, Ethereum-anchored
execution layer of Vara (Gear's `ethexe`). It is a fresh build, not a feature toggle bolted onto
the existing app. The product behavior is identical to PolyBaskets-on-Vara — bundle multiple
Polymarket outcomes into a weighted basket and bet on the bundle as a single position — but the
chain, the wallet, and the transaction model are different.

Two things make this version distinct:

1. **Privy login** — users sign in with email or a social account. Privy provisions an embedded
   wallet behind the scenes. No browser extension, no seed phrase. Crypto-native users can still
   connect an external wallet.
2. **Injected pre-confirmations** — writes are submitted *into Vara.eth directly* (not as normal
   gas-paying Ethereum transactions). The user gets a near-instant pre-confirmation "promise" and a
   gasless-feeling experience, while Ethereum provides settlement underneath.

## How this relates to the existing live app

| | PolyBaskets (live) | PolyBaskets-ETH (this plan) |
|---|---|---|
| Chain | Vara native (Substrate / Gear) | Vara.eth (ethexe, Ethereum-settled) |
| Wallet | SubWallet / Talisman via `@gear-js` | **Privy** embedded + external via viem |
| Tx model | Sails `TransactionBuilder` | **Injected** (pre-confirm) + classic Mirror fallback |
| Value | native TVARA | **deposit ledger: native ETH _and_ wVARA**; hot path spends internal balance (zero-value injected) |
| Data | Polymarket Gamma API | **same Polymarket Gamma API (reused 100%)** |
| Basket math | `basket-utils` / `betCalculator` | **same math (reused 100%)** |

The existing repo already contains a partial Vara.eth client (`src/lib/varaEthBasketClient.ts`,
944 lines) that targets the Hoodi testnet with MetaMask. **We treat that as a reference, not the
foundation** — the new app is a clean port with Privy and a token-bet model, and it lives in its
own folder so the live Vara app is never destabilized.

## Product surface (parity with the live app)

The new app ships the same core pages, rebuilt against the Vara.eth interaction layer:

- **Landing / Explore** — discover Polymarket markets (reuses `polymarket.ts`)
- **Builder** — compose a weighted basket of outcomes (reuses `basket-utils.ts`)
- **Basket detail** — view a basket, its live index, place a bet
- **My Baskets** — positions the user holds
- **Claim** — claim payouts from settled baskets
- **Leaderboard / Stats** — optional, second wave

## Deployment shape

A separate Vite app (its own `package.json`, its own Railway service or subdomain). The brief
mentioned the live app sits at `app.polybaskets.xyz`; this can ship as e.g.
`eth.polybaskets.xyz` or `app.polybaskets.xyz/eth`, decided at deploy time (see
[12-open-questions.md](./12-open-questions.md)).

## Non-goals (for the first cut)

- No migration of existing Vara baskets onto Vara.eth — it's a parallel deployment.
- No cross-chain bridging of positions between Vara and Vara.eth.
- No Solidity-adapter (ABI) path in v1 — we go direct Sails/Mirror + injected. The ABI path is
  documented as a future option in [04-contracts.md](./04-contracts.md).
