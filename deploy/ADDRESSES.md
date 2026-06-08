# PolyBaskets-ETH — Live Addresses & Funding (Hoodi testnet · chain 560048)

## 🔑 Operator wallet — FUND THIS ONE
The single wallet that runs everything (deployer, owner, relayer, settler, pool seeder):

```
0x9fF54f4A4c1874163b20f3523af1149f0c75e8a2
```

Send it on **Hoodi**:
| Asset | Why | Suggested |
|-------|-----|-----------|
| **ETH** | gas for every tx (deposits, settlements, vault releases, pool seeds, top-ups) | 0.3–1.0 ETH |
| **wVARA** (`0xE1ab85…`) | program **executable balance** (message gas) + **house-pool backing** | 1000–5000 wVARA |

> wVARA has **12 decimals** (1 wVARA = 1_000_000_000_000). After funding, ping to top up the program's executable balance + grow the pools.

## Contracts (live)
| What | Address |
|------|---------|
| **BasketMarket program** (the one we use) | `0xe3bead8473c4cd6fe59f4aee81aa446be271a101` |
| **WvaraVault** (custodies real wVARA) | `0xA91Ba5c6EDb2f2A9bBf7aa813049B1817A3B7287` |
| **Router** (current Hoodi ethexe) | `0xE549b0AfEdA978271FF7E712232B9F7f39A0b060` |
| **wVARA token** | `0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464` |
| Code id (deployed) | `0xab37e421d03b36066362c3fd8e4b2215d2448d8099783116d0654906ef406c3f` |

## Endpoints
- Ethereum (Hoodi) RPC: `https://ethereum-hoodi-rpc.publicnode.com`
- Vara.eth WS: `wss://vara-eth-validator-1.gear-tech.io`

## Roles
- **owner / settler / relayer** = the operator wallet above (all one key for now).
- The wVARA bridge: `vault.deposit` (real pull) → relayer `credit_wvara`; `withdraw_wvara` queues → relayer `vault.release`.

## NOT ours (ignore)
- Program `0x9fc2de98…77440435` — created by a different wallet (`0x3A909a…329B2f`); its 2000 wVARA is in that wallet's control, unrelated to this deployment.

## Env files
- `app/.env` — frontend (public `VITE_*` vars; already set).
- `deploy/.env.deploy` — secrets (deployer key) + addresses for the scripts. **gitignored.**
