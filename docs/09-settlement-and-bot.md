# 09 — Settlement & Settler Bot

The settlement *lifecycle* is identical to the live app; only the **chain calls** change from
Sails-on-Vara to Vara.eth.

## Lifecycle (unchanged)

```
Basket Active
   │  all legs resolve on Polymarket
   ▼
ProposeSettlement(basket_id, item_resolutions, payload)   ← settler role
   │  challenge window (liveness_seconds, e.g. 12 min)
   ▼
FinalizeSettlement(basket_id)                             ← after window
   │
   ▼
Basket Settled → users Claim (payout → ledger) → Withdraw
```

- `item_resolutions` come from Polymarket resolution (the bot already reads this).
- Payout per position uses the existing formula `shares × settlement_index_bps / index_at_creation_bps`,
  now crediting the **per-collateral ledger** instead of transferring value (see
  [03-value-collateral-and-deposits.md](./03-value-collateral-and-deposits.md)).

## Settler bot changes

The bot (`settler-bot/`) has two halves; only one changes:

| Half | Change |
|------|--------|
| Polymarket polling (every 30s, detect resolved markets) | **none** — same Gamma API |
| On-chain propose/finalize | **swap** Sails `TransactionBuilder` for Vara.eth signer + messages |

### New chain adapter for the bot
A Node-side `@vara-eth/api` client signed by the settler key:

```ts
const account = privateKeyToAccount(process.env.SETTLER_PRIVATE_KEY);   // settler role
const walletClient = createWalletClient({ account, transport: http(ETH_RPC) });
const signer = walletClientToSigner(walletClient);
const api = await createVaraEthApi(new WsVaraEthProvider(VARA_ETH_WS), publicClient, ROUTER, signer);
const mirror = getMirrorClient({ address: PROGRAM_ID, publicClient, signer });

// propose / finalize are zero-value writes → can be injected (fast) or classic
await api.createInjectedTransaction({ destination: PROGRAM_ID, payload: proposePayload, value: 0n });
```

- Propose & finalize carry **no value** → eligible for the injected path (or classic for stronger
  finality guarantees; choose per ops preference).
- The settler key must hold the `settler_role` set at program init, and the bot must keep the
  program's **executable balance** topped up (or a separate operator job does).

### Decision: reuse vs fork the bot
Two options (tracked in [12-open-questions.md](./12-open-questions.md)):
- **Fork** a `polybaskets-eth/settler/` copy with the Vara.eth adapter (keeps the live bot untouched —
  matches the strictly-additive rule). **Recommended.**
- **Extend** the existing bot with a network switch. Faster but touches live code — avoid for v1.

## World Cup note
World Cup markets resolve at well-defined times (match end / tournament end). Verify Polymarket's
resolution fields and timing during the data spike ([08-polymarket-reuse.md](./08-polymarket-reuse.md))
so the bot proposes settlement promptly once legs resolve.
