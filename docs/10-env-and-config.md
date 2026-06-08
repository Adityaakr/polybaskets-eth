# 10 — Env & Config

All new config lives under `polybaskets-eth/`. We do **not** touch the parent app's env.

## Frontend (`polybaskets-eth/app/.env`)

```bash
# --- Vara.eth / Ethereum ---
VITE_ETHEREUM_RPC=https://hoodi-reth-rpc.gear-tech.io     # Hoodi L1 RPC (Router/Mirror calls)
VITE_VARA_ETH_RPC=wss://hoodi-reth-rpc.gear-tech.io/ws    # Vara.eth WS (injected + state reads)
VITE_ROUTER_ADDRESS=0x...                                 # Router for the target network
VITE_PROGRAM_ID=0x...                                     # BasketMarket program/Mirror (after create)
VITE_WVARA_ADDRESS=0x...                                  # wVARA ERC-20 (for deposit/approve/balanceOf)
VITE_CHAIN_ID=560048                                      # Hoodi

# --- Privy ---
VITE_PRIVY_APP_ID=...                                     # from Privy dashboard

# --- Polymarket (reused) ---
VITE_GAMMA_PROXY=https://gamma-api.polymarket.com         # or the Vite dev proxy
VITE_WORLD_CUP_WINNER_SLUG=...                            # pinned canonical World Cup market (curation)
VITE_WORLD_CUP_TAG_ID=...                                 # resolved FIFA World Cup tag id
```

> Per the skills error-log: **do not trust stale `.env.example` Router values** — confirm the Router
> for the live target network before deploying or pointing the frontend at it. Wrong Router =
> everything "works" against the wrong state.

## Contract / ops (CLI env)

```bash
ETHEXE=ethexe
ETHEREUM_RPC=https://hoodi-reth-rpc.gear-tech.io
ROUTER=0x...
SENDER=0x...                # operator address in the ethexe keystore (never commit the key)
WASM=contract/target/wasm32-gear/release/basket_market.opt.wasm
IDL=contract/target/wasm32-gear/release/basket_market.idl
PROGRAM_ID=0x...            # captured after create
CODE_ID=0x...              # captured after upload+validation
```

## Settler bot (`polybaskets-eth/settler/.env`)

```bash
ETH_RPC=https://hoodi-reth-rpc.gear-tech.io
VARA_ETH_WS=wss://hoodi-reth-rpc.gear-tech.io/ws
ROUTER=0x...
PROGRAM_ID=0x...
SETTLER_PRIVATE_KEY=...                # settler-role key (use *_FILE / secret mgmt in prod)
POLYMARKET_POLL_INTERVAL_MS=30000
FINALIZE_ENABLED=true
```

## Network reference (Hoodi testnet)

| | Value |
|---|---|
| Chain id | `560048` (`0x88bb0`) |
| Native | ETH (18 dec) |
| wVARA | **12 dec** |
| Explorer | `https://hoodi.etherscan.io` |
| RPC (L1) | `https://hoodi-reth-rpc.gear-tech.io` |
| RPC (Vara.eth WS) | `wss://hoodi-reth-rpc.gear-tech.io/ws` |

## Secrets discipline
- Never commit private keys, the settler seed, or live personal addresses (skills rule + repo
  security guidance).
- Use Railway/host secret management for `SETTLER_PRIVATE_KEY` and `VITE_PRIVY_APP_ID` build-time
  injection.
