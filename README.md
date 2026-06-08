# polybaskets-eth

<img width="1481" height="896" alt="PolyBaskets-ETH" src="https://github.com/user-attachments/assets/4b36582c-d124-44e7-975c-e13480513191" />

**ETF-style prediction markets on Vara.eth.** Bundle multiple Polymarket outcomes into a weighted
basket and bet on it as a single on-chain position. Gasless gameplay via injected pre-confirmations,
ETH + wVARA collateral, and email (Privy) login.

<img width="499" height="158" alt="logo" src="https://github.com/user-attachments/assets/29e2e725-a19f-40c0-9ce9-54a83cc79b23" />

## How it works
- **Build a slip** — pick Polymarket outcomes, set weights. The basket's value = Σ(weight × outcome probability).
- **Bet** — stake ETH or wVARA from your deposited balance. `payout = stake × settlement_index / entry_index`.
- **Gasless** — create/bet/claim are injected, pre-confirmed messages (no popup for email wallets).
- **Settle & claim** — when every leg resolves on Polymarket, the settler finalizes; winners claim from the house pool.

## Collateral
- **ETH** — native value, deposited directly into the program.
- **wVARA** — an ERC-20 that can't be held by a Sails program, so it's custodied by a **`WvaraVault`** on Hoodi; a relayer mirrors deposits/withdrawals into the program ledger. Every balance is backed 1:1.

## Stack
- **Frontend** — React + Vite + TypeScript, TailwindCSS + shadcn/ui, Privy auth, viem + `@vara-eth/api`, recharts.
- **Contract** — Rust + Sails (Gear/ethexe) — `contract/`. Solidity vault — `contract/solidity/`.
- **Bots** — Node relayer (wVARA bridge) + settler (Polymarket-driven settlement) — `app/scripts/`.
- **Network** — Vara.eth / ethexe, settled to Ethereum (Hoodi testnet, chain `560048`).

## Run locally
```bash
cd app
cp .env.example .env       # live Hoodi values, all public
npm install                # uses .npmrc (legacy-peer-deps)
npm run dev                # http://localhost:8081
```
Operator bots (need `deploy/.env.deploy` with the operator key):
```bash
cd app && node scripts/bots.mjs    # relayer + settler
```

## Deploy
Two Railway services (frontend + bots) from this repo — see **[DEPLOY.md](DEPLOY.md)**.

## Layout
```
app/        React frontend + ops scripts (deploy, relayer, settler, seeding)
contract/   Rust/Sails BasketMarket program + Solidity WvaraVault
deploy/     ethexe wrapper, rpc proxy, addresses reference (secrets gitignored)
docs/       architecture & design notes
```

> Testnet only. The operator private key lives in `deploy/.env.deploy` (gitignored) and Railway secrets — never in the frontend or this repo.
