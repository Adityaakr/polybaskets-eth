# PolyBaskets-ETH — Planning Docs

> A from-scratch port of PolyBaskets onto **Vara.eth** (Gear's ethexe / Ethereum-settled layer),
> with **Privy embedded-wallet login** and **injected pre-confirmation** UX, reusing the existing
> Polymarket data layer and basket math 100%.

This folder is the **plan of record**. No app code lives here yet — these docs define what we build,
why, and in what order, before a single line of the new app is written.

> ## ⛔ Strictly additive — the live Vara app is untouched
> PolyBaskets-ETH is a **new port and a new site**. Nothing in this effort modifies, removes, or
> destabilizes the existing PolyBaskets-on-Vara app, its contracts (`program/`, `bet-token/`,
> `bet-lane/`), its frontend, or its deployment. All new code lives under `polybaskets-eth/`.
> Shared logic (Polymarket client, basket math) is **copied in**, never edited in place. See
> [00-overview.md](./00-overview.md) and [08-polymarket-reuse.md](./08-polymarket-reuse.md).

## Decisions locked (2026-06-07)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Value / collateral model | **Deposit-and-credit ledger** supporting **native ETH _and_ wVARA**. Value crosses the boundary only on deposit/withdraw (gas-paying L1 txs). The hot path (create / bet / claim) spends an internal balance via **zero-value injected, pre-confirmed** messages → gasless-feeling. |
| 2 | Contract strategy | **Fresh Sails contract**, uploaded + validated + created new via the `ethexe` CLI on Vara.eth. |
| 3 | Login | **Privy embedded wallet + email/social**, with optional external-wallet connect. |

## Read in this order

| Doc | What it covers |
|-----|----------------|
| [00-overview.md](./00-overview.md) | Vision, how this relates to the live Vara app, product surface |
| [01-vara-eth-primer.md](./01-vara-eth-primer.md) | How Vara.eth works: Router, Mirror, injected vs classic vs ABI, wVARA |
| [02-architecture.md](./02-architecture.md) | System architecture, component map, what we reuse vs build |
| [03-value-collateral-and-deposits.md](./03-value-collateral-and-deposits.md) | **The deposit/credit model in depth: native ETH + wVARA, the internal ledger, deposit / bet / claim / withdraw flows** |
| [04-contracts.md](./04-contracts.md) | The Sails contracts: BasketMarket + ledger, types, services, methods |
| [05-wallet-and-tx-flow.md](./05-wallet-and-tx-flow.md) | Privy → viem → @vara-eth/api signer wiring, injected vs classic per action |
| [06-frontend.md](./06-frontend.md) | New Vite app: structure, pages, contexts, the interaction module |
| [07-design-system.md](./07-design-system.md) | **Polished, card-based UI: reuse PolyBaskets palette, Polymarket-style expandable positions, multi-select** |
| [08-polymarket-reuse.md](./08-polymarket-reuse.md) | Exactly what we lift from the existing repo and how |
| [09-settlement-and-bot.md](./09-settlement-and-bot.md) | Settlement lifecycle + settler bot adaptation for Vara.eth |
| [10-env-and-config.md](./10-env-and-config.md) | Env vars, network config, addresses |
| [11-roadmap.md](./11-roadmap.md) | Phased milestones and task breakdown |
| [12-open-questions.md](./12-open-questions.md) | Things to resolve before/while building |

## Source material

- Vara.eth skills repo: `gear-foundation/vara-eth-skills` (cloned to `/tmp/vara-eth-skills` during planning)
- Existing PolyBaskets repo: the parent of this folder (`/Users/adityakrx/polybaskets-1`)
- Key existing files we lean on: `src/lib/polymarket.ts`, `src/lib/basket-utils.ts`,
  `src/lib/betCalculator.ts`, `src/lib/varaEthBasketClient.ts`, `src/lib/varaEthClient.ts`
