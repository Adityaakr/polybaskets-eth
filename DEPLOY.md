# Deploying PolyBaskets-ETH to Railway

The web app lives in **`app/`** and is served in production by **`app/server.mjs`** — a tiny
zero-dependency Node server that serves the Vite build **and** proxies the Polymarket APIs
(`/gamma`, `/clob`) so the market data + probability charts work without CORS issues.

## 1. Create the service
1. Railway → **New Project** → **Deploy from GitHub repo** → `Adityaakr/polybaskets-eth`.
2. Open the service → **Settings** → set **Root Directory** to:
   ```
   app
   ```
   (the app is in a subfolder — this is required.)

Build/start are auto-detected from `app/nixpacks.toml`:
- install → `npm ci --legacy-peer-deps`
- build → `npm run build` (Vite → `dist/`)
- start → `node server.mjs` (binds Railway's `$PORT`)

## 2. Set environment variables
Service → **Variables** → add these (all **public**, no secrets). `VITE_*` are baked in at
**build time**, so a change requires a redeploy. Values are the live Hoodi deployment — see
`app/.env.example`:

```
VITE_ETHEREUM_RPC=https://ethereum-hoodi-rpc.publicnode.com
VITE_VARA_ETH_RPC=wss://vara-eth-validator-1.gear-tech.io
VITE_CHAIN_ID=560048
VITE_ROUTER_ADDRESS=0xE549b0AfEdA978271FF7E712232B9F7f39A0b060
VITE_PROGRAM_ID=0xe3bead8473c4cd6fe59f4aee81aa446be271a101
VITE_WVARA_ADDRESS=0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464
VITE_WVARA_VAULT=0xA91Ba5c6EDb2f2A9bBf7aa813049B1817A3B7287
VITE_PRIVY_APP_ID=cmq43ji7y026g0cl71tlecd6r
VITE_GAMMA_PROXY=https://gamma-api.polymarket.com
VITE_WORLD_CUP_WINNER_SLUG=world-cup-winner
VITE_WORLD_CUP_TAG_ID=102350
```
Do **not** set `PORT` — Railway provides it.

## 3. After the first deploy
- Railway gives you a domain (e.g. `https://polybaskets-eth-production.up.railway.app`).
- **Privy dashboard** → your app (`cmq43ji7y026g0cl71tlecd6r`) → **Allowed origins / domains** →
  add that Railway domain (and any custom domain). Login won't work until this is set.

## What is NOT on Railway (runs separately)
The web service is frontend-only. These backend operator services run on a machine/service that
holds the operator key (`deploy/.env.deploy`), never in the frontend:
- `app/scripts/relayer.mjs` — wVARA deposit/withdrawal bridge
- `app/scripts/settler.mjs` — Polymarket-driven settlement
Run them where the key lives (`node scripts/relayer.mjs`, `node scripts/settler.mjs`). If you want
them on Railway too, deploy them as **separate services** with the key set as a private variable.

## Local production check
```bash
cd app
npm run build
node server.mjs        # serves on :8080, proxies /gamma + /clob
```
