# 06 — Frontend (new Vite app)

A standalone React + TypeScript + Vite app under `polybaskets-eth/app/`, sharing the stack the
existing repo already uses (React 18, Tailwind, shadcn/ui, TanStack Query) so reused libs and design
tokens port cleanly. **Nothing in the parent app is edited** — shared files are copied in.

## Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Build | Vite + SWC | same as parent |
| UI | Tailwind + shadcn/ui (Radix) | reuse PolyBaskets tokens → [07-design-system.md](./07-design-system.md) |
| Data fetching | TanStack Query | wrap Polymarket + chain reads |
| Auth/wallet | `@privy-io/react-auth` | embedded + external |
| Chain | `@vara-eth/api`, `viem`, `sails-js` | interaction layer |
| Forms | react-hook-form + zod | basket builder validation |

## Directory layout

```
app/
├── index.html
├── package.json
├── vite.config.ts                 # Polymarket CORS proxy (copied from parent dev server)
├── public/
│   └── basket_market.idl          # generated IDL for SailsProgram payload codec
└── src/
    ├── main.tsx                   # <PrivyProvider> + <QueryClientProvider> + router
    ├── lib/
    │   ├── polymarket.ts          # COPIED from parent (unchanged)
    │   ├── basket-utils.ts        # COPIED (unchanged)
    │   ├── betCalculator.ts       # COPIED (unchanged)
    │   └── varaeth/               # NEW interaction layer (see doc 02 / 05)
    │       ├── session.ts
    │       ├── api.ts
    │       ├── idl.ts
    │       ├── basketMarket.ts
    │       ├── ledger.ts
    │       ├── injected.ts
    │       ├── classic.ts
    │       └── config.ts
    ├── contexts/
    │   ├── WalletContext.tsx       # wraps Privy session → VaraEthSession
    │   ├── LedgerContext.tsx       # ETH + wVARA balances, deposit/withdraw state
    │   └── BasketContext.tsx       # draft basket (COPIED + trimmed)
    ├── hooks/
    │   ├── useBalances.ts          # wallet + ledger balances per collateral
    │   ├── useBasket.ts            # read a basket + live index
    │   ├── usePositions.ts         # user positions, enriched
    │   └── useMarkets.ts           # Polymarket search (wraps copied lib)
    ├── components/                 # cards, position drawer, deposit modal, multi-select tray
    └── pages/
        ├── ExplorePage.tsx
        ├── BuilderPage.tsx
        ├── BasketPage.tsx
        ├── MyBasketsPage.tsx
        ├── WalletPage.tsx          # deposit / withdraw ETH + wVARA, balances
        ├── ClaimPage.tsx
        └── LandingPage.tsx
```

## Pages (parity + the new Wallet/Deposit page)

| Page | Purpose | Chain calls |
|------|---------|-------------|
| Landing | marketing entry, "Sign in with email" | Privy login |
| Explore | browse/search Polymarket markets, multi-select into a tray | reads only (Polymarket) |
| Builder | weight selected outcomes into a basket, validate, create | `CreateBasket` (injected) |
| Basket | basket detail, live index, expandable per-position cards, place bet | `GetBasket`, `BetOnBasket` (injected) |
| MyBaskets | user's positions across baskets, P&L, claim entry | `GetPositions`, `GetSettlement` |
| **Wallet** | **deposit/withdraw ETH + wVARA, show wallet + ledger balances** | `DepositEth`/`DepositWvara`/`Withdraw*` (classic), `GetBalances` |
| Claim | claim settled payouts → ledger, then optional withdraw | `Claim` (injected) |

## Data flow

```
Polymarket Gamma ──useMarkets──► Explore/Builder (USD prices, probabilities)
                                        │ basket-utils (weighted index), betCalculator (USD→collateral)
                                        ▼
        BasketContext (draft) ──CreateBasket(injected)──► program
                                        ▼
   LedgerContext (ETH/wVARA balances) ──BetOnBasket(injected)──► program
                                        ▼
        usePositions ◄──GetPositions/GetSettlement(reads)── program
                                        ▼
                    ClaimPage ──Claim(injected)──► ledger ──Withdraw(classic)──► wallet
```

## Component reuse note

Where the parent app already has good building blocks (market cards, search bar, weight sliders,
number formatting per the `number-formatting` guidance), we **copy and re-skin** them — we don't
import across the folder boundary, to keep the new app independently buildable and the old app
untouched. The design upgrades (card-based, expandable positions) are specified in
[07-design-system.md](./07-design-system.md).
