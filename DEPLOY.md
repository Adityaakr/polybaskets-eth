# Deploying PolyBaskets-ETH to Railway

Two services from the **same repo**, both with **Root Directory = `app`**:

| Service | What it is | Start command | Exposes |
|---------|-----------|---------------|---------|
| **web** | the frontend (Vite build, served + `/gamma` `/clob` proxies) | `node server.mjs` (default) | public URL, `/healthz` |
| **bots** | operator backend — wVARA **relayer** + Polymarket **settler** | `npm run start:bots` | `/healthz` |

Both run `node` and bind Railway's `$PORT`. The `app/nixpacks.toml` handles install → build → start.

---

## Service A — Frontend (web)

1. Railway → **New Project → Deploy from GitHub** → `Adityaakr/polybaskets-eth`.
2. Service **Settings → Root Directory** = `app`.
3. Start command: leave default (`node server.mjs` from `nixpacks.toml`).
4. **Variables** (all PUBLIC — `VITE_*` are baked in at build time; see `app/.env.example`):
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
5. **Health check path** (Settings → Healthcheck): `/healthz`
6. Do **not** set `PORT` — Railway provides it.

### After first deploy — REQUIRED
Railway gives a domain (e.g. `https://…up.railway.app`). Add it to
**Privy dashboard → app `cmq43ji7y026g0cl71tlecd6r` → Allowed origins/domains**, or login won't work.

---

## Service B — Operator bots (relayer + settler)

In the **same project**, add another service from the same repo (**+ New → GitHub Repo** → same repo).

1. **Settings → Root Directory** = `app`.
2. **Settings → Custom Start Command** = `npm run start:bots`
   (runs the relayer + settler together, auto-restarting, with `/healthz`).
3. **Health check path**: `/healthz`
4. **Variables** — these include the **operator PRIVATE KEY**, so mark it secret. Take the values
   from your local `deploy/.env.deploy`:
   ```
   DEPLOYER_PRIVATE_KEY=0x…          ← SECRET. the operator/owner/settler key
   ROUTER=0xE549b0AfEdA978271FF7E712232B9F7f39A0b060
   WVARA=0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464
   WVARA_VAULT=0xA91Ba5c6EDb2f2A9bBf7aa813049B1817A3B7287
   VARA_ETH_WS=wss://vara-eth-validator-1.gear-tech.io
   ETHEREUM_RPC=https://ethereum-hoodi-rpc.publicnode.com
   PROGRAM_ID=0xe3bead8473c4cd6fe59f4aee81aa446be271a101
   ```
   The bots read these via `app/scripts/_env.mjs` (env first, then `deploy/.env.deploy` locally).

### Relayer state (important)
The relayer tracks processed deposits in `deploy/relayer-state.json`. Railway's filesystem is
**ephemeral** (wiped on redeploy), so to avoid re-processing on restart, attach a **Volume** and set:
```
RELAYER_STATE_PATH=/data/relayer-state.json     # mount the volume at /data
```
For a simple demo you can skip this (on restart it resumes from the latest block; deposits made
while it was down may need a re-trigger). The **settler is stateless** and needs no volume.

### Run them separately instead?
If you prefer one service per bot: set the start command to `npm run start:relayer` or
`npm run start:settler` on two services. Each still serves `/healthz`.

---

## Local production check
```bash
cd app
npm run build && node server.mjs     # web on :8080 — try /, /explore, /healthz, /clob/...
node scripts/bots.mjs                 # relayer + settler + /healthz (reads deploy/.env.deploy)
```
