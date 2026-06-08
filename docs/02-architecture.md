# 02 — System Architecture

## Component map

```
┌──────────────────────────────────────────────────────────────────────────┐
│  polybaskets-eth (new Vite app)                                            │
│                                                                            │
│  Pages: Explore · Builder · Basket · MyBaskets · Wallet/Deposit · Claim    │
│                                                                            │
│  ┌───────────────┐   ┌──────────────────────────────────────────────┐     │
│  │ Reused libs   │   │ New Vara.eth interaction layer                │     │
│  │ (copied)      │   │  src/lib/varaeth/                             │     │
│  │ • polymarket  │   │   • session.ts   (Privy → viem → signer)      │     │
│  │ • basket-utils│   │   • api.ts       (createVaraEthApi, provider) │     │
│  │ • betCalc     │   │   • idl.ts       (SailsProgram payload codec) │     │
│  │ • number-fmt  │   │   • basketMarket.ts (create/bet/claim/query)  │     │
│  └───────────────┘   │   • ledger.ts    (deposit/withdraw/balances)  │     │
│                      │   • injected.ts  (createInjectedTransaction)  │     │
│  ┌───────────────┐   │   • classic.ts   (mirror.sendMessage + value) │     │
│  │ Contexts      │   └──────────────────────────────────────────────┘     │
│  │ • PrivyProvider (login, embedded wallet)                          │     │
│  │ • WalletCtx (address, chain, signer)                              │     │
│  │ • LedgerCtx (ETH + wVARA balances, deposit state)                 │     │
│  │ • BasketCtx (draft basket)                                        │     │
│  └───────────────┘                                                        │
└──────────────────────────────────────────────────────────────────────────┘
            │ injected (zero-value)        │ classic (value-in/out)
            ▼                              ▼
   ┌──────────────────┐          ┌───────────────────────┐
   │  Vara.eth (RPC)  │◄────────►│  Ethereum / Hoodi      │
   │  Program exec    │  settle  │  Router + Mirror(s)    │
   │  BasketMarket    │          │  wVARA ERC-20          │
   │  + internal      │          │  (holds deposited ETH/ │
   │    ledger        │          │   wVARA value)         │
   └──────────────────┘          └───────────────────────┘
            ▲
            │ polls resolved markets, proposes/finalizes settlement
   ┌──────────────────┐
   │  Settler bot     │  (Node service, adapted for Vara.eth signer)
   └──────────────────┘
            ▲
            │ reads market resolution
   ┌──────────────────┐
   │ Polymarket Gamma │  (unchanged — same API both apps use)
   └──────────────────┘
```

## Layers

### 1. Data layer (reused, unchanged)
`polymarket.ts`, `basket-utils.ts`, `betCalculator.ts` move over essentially verbatim. They have no
chain dependency — they fetch markets, compute the weighted index, and size bets in USD. See
[08-polymarket-reuse.md](./08-polymarket-reuse.md).

### 2. Interaction layer (new — `src/lib/varaeth/`)
A typed wrapper around `@vara-eth/api` + `viem` + `sails-js`. **No React in here.** It exposes:
- `connect(privyProvider)` → a `VaraEthSession` (address, api, signer, publicClient).
- `ledger.deposit(collateral, amount)` / `ledger.withdraw(...)` / `ledger.balances(user)`.
- `basketMarket.createBasket(...)` / `.bet(...)` / `.claim(...)` (all injected).
- `basketMarket.getBasket / getPositions / getSettlement` (free reads).

It mirrors the *shape* of the existing `src/lib/varaEthBasketClient.ts` (which already does the
injected + classic dance) but is rebuilt around Privy and the deposit ledger. We lift its proven
encode/decode and reply-listener code.

### 3. Wallet layer (new — Privy)
`PrivyProvider` wraps the app. On login Privy yields an EIP-1193 provider (embedded or external);
we wrap it in a viem `walletClient` and convert to a `@vara-eth/api` signer. One signer drives both
injected (Vara.eth) and classic (Ethereum/Hoodi) paths. See [05-wallet-and-tx-flow.md](./05-wallet-and-tx-flow.md).

### 4. Contracts (new — fresh Sails program)
`BasketMarket` Sails program extended with an **internal multi-collateral ledger** and
deposit/withdraw entrypoints. Deployed fresh on Hoodi via `ethexe`. See [04-contracts.md](./04-contracts.md).

### 5. Settlement (adapted)
The settler bot's chain calls are swapped from Sails-on-Vara to Vara.eth (signer + injected/classic),
its Polymarket polling is unchanged. See [09-settlement-and-bot.md](./09-settlement-and-bot.md).

## Action → path matrix (the spine of the design)

| User action | Carries value? | Path | UX |
|-------------|---------------|------|-----|
| Login | — | Privy | email/social, instant |
| **Deposit ETH** | ✅ in | classic `mirror.sendMessage(payload, value)` | 1 Ethereum tx, gas |
| **Deposit wVARA** | ✅ in | `wvara.approve` + classic deposit msg | 1–2 Ethereum txs, gas |
| Create basket | ❌ | **injected** | pre-confirmed, gasless |
| Place bet | ❌ (spends ledger) | **injected** | pre-confirmed, gasless |
| Claim payout → balance | ❌ | **injected** | pre-confirmed, gasless |
| Read state | ❌ | `calculateReplyForHandle` | free, no signature |
| **Withdraw** | ✅ out | classic message (value egress via Mirror) | 1 Ethereum tx, gas |

Deposit and withdraw are the only two times a user signs a real Ethereum transaction or pays gas.
Everything in between feels like web2.

## Repository shape

```
polybaskets-eth/
├── docs/                      ← this plan
├── contract/                  ← fresh Sails BasketMarket (Rust)
│   ├── app/src/lib.rs
│   ├── client/                ← generated IDL + client
│   └── tests/gtest.rs
├── app/                       ← the Vite frontend (or root-level src/)
│   ├── src/lib/varaeth/       ← interaction layer
│   ├── src/lib/polymarket.ts  ← copied from parent
│   ├── src/contexts/
│   ├── src/pages/
│   └── package.json
├── settler/                   ← adapted settler bot (or reuse parent's)
└── .env.example
```

> Decision pending: whether `contract/` and `settler/` live inside this folder or reuse the parent
> repo's `program/` and `settler-bot/`. See [12-open-questions.md](./12-open-questions.md).
