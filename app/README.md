# PolyBaskets-ETH — Frontend

A from-scratch Vara.eth port of PolyBaskets: bundle Polymarket outcomes into a weighted **slip**,
log in with **Privy** (email/social embedded wallet), deposit **ETH or wVARA**, and place **gasless,
pre-confirmed** bets settled on Vara.eth. Reuses the parent app's Polymarket data layer and basket
math verbatim. See `../docs/` for the full plan.

## Run

```bash
npm install          # uses ../.npmrc legacy-peer-deps via local .npmrc
cp .env.example .env # fill in values (works degraded with just the gamma proxy)
npm run dev          # http://localhost:8081
npm run build        # production build (vite/esbuild)
```

The app **boots and runs without chain/Privy config** (degraded mode): Polymarket browsing, slip
building, and the World Cup hero all work. Login + on-chain actions light up once you set
`VITE_PRIVY_APP_ID`, `VITE_ROUTER_ADDRESS`, `VITE_PROGRAM_ID` and drop the contract IDL at
`public/basket_market.idl`.

## Structure

| Path | Role |
|------|------|
| `src/lib/polymarket.ts`, `basket-utils.ts`, `betCalculator.ts` | copied from parent (unchanged) |
| `src/lib/worldCup.ts` | World Cup 26 curation (hero + legs) |
| `src/lib/odds.ts` | probability ↔ sportsbook odds presentation |
| `src/lib/varaeth/` | Vara.eth interaction layer (session, client, format) |
| `src/contexts/` | Wallet (Privy), Ledger (balances/deposit/bet/claim), Basket (slip draft) |
| `src/components/` | Layout, MarketCard, SlipTray, WorldCupHero, ConnectButton |
| `src/pages/` | Landing, Explore, Builder, Wallet, MyBaskets, Basket |

## Status

- ✅ Builds and runs (`vite build` green, dev server serves on :8081)
- ✅ Polymarket data + World Cup hero + multi-select slip + wallet UI
- ✅ Interaction layer wired to `@vara-eth/api` (injected create/bet/claim, classic deposit/withdraw)
- ⏳ On-chain E2E requires: deployed program (see `../contract/`), IDL in `public/`, env set, Privy app id

## Design

Reuses the PolyBaskets palette (dark navy + neon-green) from the parent's `src/index.css`. The slip
model, expandable positions, and World Cup focus follow `../docs/07-design-system.md`.
