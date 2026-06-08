# 05 — Wallet & Transaction Flow (Privy + injected pre-confirmations)

## Why Privy drops in cleanly

The entire Vara.eth signing stack only needs **one thing**: a viem `walletClient` backed by an
EIP-1193 provider. The skills examples build it from `window.ethereum`:

```ts
const walletClient = createWalletClient({ account, transport: custom(window.ethereum) });
const signer = walletClientToSigner(walletClient);           // "@vara-eth/api/signer"
const api = await createVaraEthApi(provider, publicClient, routerAddress, signer);
```

Privy exposes exactly that EIP-1193 provider — for both **embedded** wallets (created on email/social
login) and **external** wallets (MetaMask, Rainbow, …). So we swap `window.ethereum` for Privy's
provider and the rest of the stack is unchanged.

## The signer wiring (one signer, two paths)

```ts
// src/lib/varaeth/session.ts
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, createPublicClient, custom, http } from "viem";
import { walletClientToSigner } from "@vara-eth/api/signer";
import { createVaraEthApi, WsVaraEthProvider, getMirrorClient } from "@vara-eth/api";

export async function buildSession(privyWallet, cfg): Promise<VaraEthSession> {
  // 1. EIP-1193 provider from Privy (embedded OR external — same interface)
  const eip1193 = await privyWallet.getEthereumProvider();

  // 2. ensure the wallet is on Hoodi (560048) — for external wallets; embedded is configured to it
  await ensureHoodiChain(eip1193, cfg.ethRpc);

  // 3. viem clients
  const account  = privyWallet.address as `0x${string}`;
  const chain    = hoodiChain(cfg.ethRpc);
  const publicClient = createPublicClient({ chain, transport: http(cfg.ethRpc) });
  const walletClient = createWalletClient({ account, chain, transport: custom(eip1193) });

  // 4. one signer drives BOTH injected (Vara.eth) and classic (Ethereum) writes
  const signer   = walletClientToSigner(walletClient);
  const provider = new WsVaraEthProvider(cfg.varaEthWs);
  await provider.connect();
  const api = await createVaraEthApi(provider, publicClient, cfg.routerAddress, signer);
  const mirror = getMirrorClient({ address: cfg.programId, publicClient, signer });

  return { account, api, mirror, publicClient, walletClient, provider };
}
```

## Per-action routing

```ts
// src/lib/varaeth/basketMarket.ts
async function injectedWrite(api, programId, payload) {                 // create / bet / claim
  const tx = await api.createInjectedTransaction({ destination: programId, payload, value: 0n });
  const promise = await tx.sendAndWaitForPromise();   // ← PRE-CONFIRMATION (fast, gasless)
  await promise.validateSignature();
  if (promise.code.isError) throw new Error(promise.code.reason);
  return { messageId: tx.messageId, txHash: promise.txHash };
}

async function classicWriteWithValue(mirror, payload, value) {          // deposit ETH
  const tx = await mirror.sendMessage(payload, value);   // real Hoodi tx, user pays gas
  await tx.send();
  return (await tx.setupReplyListener()).waitForReply();
}
```

| Action | Function | Signature prompt? | Cost to user |
|--------|----------|-------------------|--------------|
| Create basket | `injectedWrite` | Privy signs the injected promise (silent/embedded) | none |
| Place bet | `injectedWrite` | same | none |
| Claim | `injectedWrite` | same | none |
| Deposit ETH | `classicWriteWithValue` | yes — Hoodi tx | gas + the deposited ETH |
| Deposit wVARA | `approve` + classic | yes — 1–2 txs | gas + the deposited wVARA |
| Withdraw | classic | yes — Hoodi tx | gas |
| Any read | `calculateReplyForHandle` | no | none |

## UX states to render (per the skills "real async states" rule)

Every write surfaces distinct states so the UI never lies about finality:

```
disconnected → wrong-network → signing → pre-confirm-pending → confirmed(read) → failed
```

For injected writes, `pre-confirm-pending` resolves at `sendAndWaitForPromise()`; we then do a
follow-up state read (`calculateReplyForHandle`) and only flip to `confirmed` once the read reflects
the change (don't trust the promise alone for displayed state).

## Chain config (Hoodi)

```ts
const HOODI = { id: 560048, hex: "0x88bb0", name: "Hoodi",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                explorer: "https://hoodi.etherscan.io" };
```

`ensureHoodiChain` mirrors the `escrow` example's `wallet_switchEthereumChain` / `wallet_addEthereumChain`
logic for external wallets; Privy embedded wallets are configured to Hoodi at provider setup so the
switch is a no-op.

## Privy provider setup (app root)

```tsx
<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    loginMethods: ["email", "google", "twitter", "wallet"],   // embedded + external
    embeddedWallets: { createOnLogin: "users-without-wallets" },
    defaultChain: hoodiChain,
    supportedChains: [hoodiChain],
    appearance: { theme: "dark", accentColor: "<PolyBaskets accent>" },  // see 07-design-system
  }}
>
  <App />
</PrivyProvider>
```

## Reference code we lift from the existing repo

`src/lib/varaEthBasketClient.ts` already implements the injected-then-classic fallback, the Sails
IDL payload encode/decode, the Mirror reply listener, and the 30s reply timeout. We port that logic
into `src/lib/varaeth/*`, replacing its `window.ethereum`/MetaMask assumptions with the Privy
provider and adding the ledger deposit/withdraw calls.
