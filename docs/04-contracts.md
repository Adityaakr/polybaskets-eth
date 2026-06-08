# 04 — Contracts (Sails on Vara.eth)

A **fresh** `BasketMarket` Sails program, adapted from the live Vara program's logic
(`program/app/src/lib.rs`) and extended with the multi-collateral internal ledger from
[03-value-collateral-and-deposits.md](./03-value-collateral-and-deposits.md). We do **not** modify
the existing program; we author a new one under `polybaskets-eth/contract/`.

## What changes vs the live Vara program

| Concern | Live Vara program | PolyBaskets-ETH program |
|---------|------------------|--------------------------|
| Asset model | `asset_kind: Vara \| Bet`, value attached to `BetOnBasket` | **internal ledger** keyed by `Collateral{ Eth, Wvara }`; bet spends ledger, no value attached |
| Deposit/withdraw | n/a (bet carries value) | **new** `DepositEth` (payable), `DepositWvara`, `WithdrawEth`, `WithdrawWvara` |
| Bet signature | `BetOnBasket { basket_id, index_at_creation_bps }` + value | `BetOnBasket { basket_id, collateral, amount, index_at_creation_bps }`, zero value |
| Position | `{ basket_id, user, shares, claimed, index_at_creation_bps }` | + `collateral: Collateral` |
| Claim | transfers value out | credits ledger (withdraw is separate) |
| Settlement | unchanged | unchanged |

Everything else — basket creation, weights/validation, the settlement propose→challenge→finalize
lifecycle, the payout formula — carries over directly.

## State

```rust
pub struct BasketMarketState {
    pub baskets: Vec<Basket>,
    pub positions: Vec<Position>,
    pub settlements: HashMap<u64, Settlement>,
    pub ledger: HashMap<(ActorId, Collateral), u128>,   // free balance
    pub config: Config,                                  // settler_role, liveness_seconds, owner
}
```

## Types (delta from existing)

```rust
pub enum Collateral { Eth, Wvara }

pub struct Position {
    pub basket_id: u64,
    pub user: ActorId,
    pub collateral: Collateral,      // NEW
    pub shares: u128,
    pub index_at_creation_bps: u16,
    pub claimed: bool,
}
```

`Basket`, `BasketItem`, `Settlement`, `Outcome`, `BasketStatus`, `SettlementStatus` are copied from
the existing program unchanged.

## Service: `BasketMarket`

### Constructor
```rust
New { settler_role: ActorId, liveness_seconds: u64 }
```

### Writes — gameplay (zero-value → **injected**)
| Method | Signature | Notes |
|--------|-----------|-------|
| `CreateBasket` | `{ name, description, items }` → `Result<u64>` | no collateral; pre-confirmed |
| `BetOnBasket` | `{ basket_id, collateral, amount, index_at_creation_bps }` → `Result<u128>` | debits `ledger[(src, collateral)]`, mints shares |
| `Claim` | `{ basket_id }` → `Result<u128>` | credits `ledger[(src, collateral)]` by payout |

### Writes — value movement (→ **classic**)
| Method | Signature | Value | Notes |
|--------|-----------|-------|-------|
| `DepositEth` | `{}` → `Result<u128>` | ETH in | reads `msg::value()`, credits ledger |
| `DepositWvara` | `{ amount }` → `Result<u128>` | 0 | pulls wVARA (approve+transfer_from), credits ledger |
| `WithdrawEth` | `{ amount }` → `Result<()>` | 0 | debits ledger, egress ETH to `msg::source()` |
| `WithdrawWvara` | `{ amount }` → `Result<()>` | 0 | debits ledger, egress wVARA to user |

### Writes — settlement (settler role)
| Method | Signature |
|--------|-----------|
| `ProposeSettlement` | `{ basket_id, item_resolutions, payload }` |
| `FinalizeSettlement` | `{ basket_id }` (after challenge window) |

### Queries (free reads — `calculateReplyForHandle`)
| Method | Returns |
|--------|---------|
| `GetBasket { id }` | `Result<Basket>` |
| `GetBasketCount` | `u64` |
| `GetPositions { user }` | `Vec<Position>` |
| `GetSettlement { basket_id }` | `Option<Settlement>` |
| `GetBalance { user, collateral }` | `u128` |
| `GetBalances { user }` | `Vec<(Collateral, u128)>` |
| `GetConfig` | `Config` |

## Errors (add to existing set)

```rust
ZeroValue, InsufficientBalance, WvaraTransferFailed, EthTransferFailed,
UnsupportedCollateral, // + all existing basket/settlement errors
```

## Build & deploy lifecycle (ethexe CLI)

Per [01-vara-eth-primer.md](./01-vara-eth-primer.md) and the skills `ethexe-cli-workflow` playbook:

```bash
# 1. build
cd polybaskets-eth/contract && cargo build --release
#    → target/wasm32-gear/release/basket_market.opt.wasm  + basket_market.idl

# 2. upload + validate (capture CODE_ID)
ethexe --cfg none tx --ethereum-rpc $ETH_RPC --ethereum-router $ROUTER --sender $SENDER \
  upload target/wasm32-gear/release/basket_market.opt.wasm --watch --json

# 3. create program (capture PROGRAM_ID = actor_id)
ethexe --cfg none tx ... create $CODE_ID --json

# 4. fund executable balance (operator pays; enables "gasless" user UX)
ethexe --cfg none tx ... executable-balance-top-up $PROGRAM_ID "10000 WVARA" --approve --watch --json

# 5. initialize (constructor payload from IDL — never hand-encode)
ethexe --cfg none tx ... send-message $PROGRAM_ID $INIT_PAYLOAD 0 --watch --json

# 6. smoke read GetConfig / GetBasketCount to prove logical readiness
```

## Client generation

```bash
cargo sails idl --program-name BasketMarket      # parser-friendly name
# → IDL consumed by SailsProgram (sails-js) in the frontend interaction layer (idl.ts)
```

## Testing

- `gtest` unit tests under `contract/tests/gtest.rs`: deposit credits ledger, bet debits & mints,
  insufficient-balance rejects, claim pays the formula, double-claim rejects, withdraw egresses and
  debits, settlement challenge window enforced.
- Then a **local smoke** and a **Hoodi smoke** following the skills `flow-checks.md` checklist before
  wiring the frontend.

## Future option: Solidity ABI adapter

If we later want clean ERC-20-style deposits/withdrawals or third-party EVM integrations, deploy a
generated Solidity ABI interface and create the program with `createProgramWithAbiInterface(...)`
(see skills `vara-eth-abi-interface.md`). Not needed for v1 — direct Mirror + injected covers
everything above. The `escrow` example is the reference if/when we go this route.
