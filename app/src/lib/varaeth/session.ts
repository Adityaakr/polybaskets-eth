import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { toAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { config, hoodiChain, HOODI_CHAIN_ID_HEX } from "@/config";

/** Anything that looks like an EIP-1193 provider (Privy embedded or external wallet). */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

/** Send a raw transaction. For embedded (Privy) wallets this routes through Privy's useSendTransaction
 *  (the raw EIP-1193 eth_sendTransaction returns 4100 for embedded wallets). External wallets leave it
 *  undefined and use the viem walletClient. Returns the tx hash. */
export type SendTx = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }) => Promise<`0x${string}`>;

/** Sign a 32-byte hash with raw-bytes personal_sign (the injected-tx signature). For embedded wallets
 *  this MUST go through Privy's useSignMessage — the raw EIP-1193 provider rejects it with 4100 because
 *  it never runs Privy's internal connect(). Privy detects the 0x-hex message and signs it with
 *  `encoding: "hex"`, producing the exact same signature as viem's signMessage({message:{raw}}). */
export type SignHash = (hashHex: `0x${string}`) => Promise<`0x${string}`>;

/** Privy embedded-wallet signer bundle. Both methods are the OFFICIAL Privy hooks (connect + correct
 *  address + hex encoding handled internally) — the only reliable path for an embedded wallet. */
export interface EmbeddedSigner {
  address: `0x${string}`;
  signHash: SignHash;
  sendTransaction: SendTx;
}

export interface VaraEthSession {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient: WalletClient;
  ethereumClient: EthereumClient;
  api: VaraEthApi;
  program: SailsProgram;
  /** Present for embedded wallets — send value/contract txns via Privy instead of the raw provider. */
  sendTx?: SendTx;
}

let cachedProgram: SailsProgram | null = null;

/** Load + parse the BasketMarket IDL into a SailsProgram (sails-js 1.0 encoding). Cached. */
export async function loadProgram(): Promise<SailsProgram> {
  if (cachedProgram) return cachedProgram;
  const res = await fetch("/basket_market.idl");
  if (!res.ok) throw new ChainNotReadyError("basket_market.idl not found in public/.");
  const idl = await res.text();
  const parser = new SailsIdlParser();
  await parser.init();
  cachedProgram = new SailsProgram(parser.parse(idl));
  return cachedProgram;
}

export class ChainNotReadyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ChainNotReadyError";
  }
}

/** Ensure an external EIP-1193 wallet is on Hoodi (embedded Privy wallets are pre-configured). */
async function ensureHoodi(provider: Eip1193) {
  try {
    const current = await provider.request({ method: "eth_chainId" });
    if (current === HOODI_CHAIN_ID_HEX) return;
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_CHAIN_ID_HEX }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: HOODI_CHAIN_ID_HEX,
            chainName: "Hoodi",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [config.ethRpc],
            blockExplorerUrls: ["https://hoodi.etherscan.io"],
          },
        ],
      });
    }
    // non-fatal: some embedded providers don't implement switch
  }
}

/**
 * Build a full Vara.eth session.
 * One session drives both injected (Vara.eth) and classic (Hoodi) writes.
 * Message encoding is handled by ./codec (no sails-js IDL load needed at runtime).
 *
 * Two signing paths:
 *  - `embedded` (Privy email wallet): a viem LOCAL account whose signMessage delegates to Privy's
 *    useSignMessage hook (which connects + signs the hex hash as raw bytes — the only path the
 *    embedded wallet authorizes; the raw provider 4100s). Value/contract txns go through
 *    `sendTx` (Privy's useSendTransaction). NEVER touches the raw EIP-1193 provider.
 *  - `provider` (external wallet, e.g. MetaMask): EIP-1193; signs with the wallet's own native popup.
 */
export async function buildSession(
  source: { provider: Eip1193; embedded?: undefined } | { embedded: EmbeddedSigner; provider?: undefined },
  address: `0x${string}`,
): Promise<VaraEthSession> {
  if (!config.routerAddress || !config.programId) {
    throw new ChainNotReadyError(
      "Chain not configured — set VITE_ROUTER_ADDRESS and VITE_PROGRAM_ID.",
    );
  }

  const publicClient = createPublicClient({
    chain: hoodiChain,
    transport: http(config.ethRpc),
  });

  // Embedded: a local viem account that signs the injected-tx hash via Privy's useSignMessage, then
  //   broadcasts over http(). Value/contract txns bypass the walletClient entirely via `sendTx`.
  // External: switch to Hoodi, sign + broadcast through the wallet's own provider (native popup).
  let walletClient: WalletClient;
  let sendTx: SendTx | undefined;
  if (source.embedded) {
    const { signHash, sendTransaction } = source.embedded;
    const account = toAccount({
      address,
      // The injected flow calls walletClient.signMessage({ message: { raw: <hash> } }). Forward the
      // hash (hex) to Privy's signMessage, which signs it as raw bytes — matching the validator.
      async signMessage({ message }) {
        const raw = typeof message === "string" ? message : (message as { raw: `0x${string}` | Uint8Array }).raw;
        const hex = (typeof raw === "string" ? raw : bytesToHex(raw)) as `0x${string}`;
        return signHash(hex);
      },
      // Embedded value/contract txns go through sendTx (Privy), not a raw-signed tx — these throw if hit.
      async signTransaction() {
        throw new Error("Embedded wallet: transactions are sent via Privy useSendTransaction, not signed locally.");
      },
      async signTypedData() {
        throw new Error("Embedded wallet: typed-data signing is not used.");
      },
    });
    walletClient = createWalletClient({ account, chain: hoodiChain, transport: http(config.ethRpc) });
    sendTx = sendTransaction;
  } else {
    await ensureHoodi(source.provider);
    walletClient = createWalletClient({
      account: address,
      chain: hoodiChain,
      transport: custom(source.provider),
    });
  }

  const ethereumClient = new EthereumClient(
    publicClient,
    walletClient,
    config.routerAddress,
  );
  await ethereumClient.isInitialized;

  const wsProvider = new WsVaraEthProvider(config.varaEthWs);
  await wsProvider.connect();
  const api = new VaraEthApi(wsProvider, ethereumClient);

  const program = await loadProgram();

  return { address, publicClient, walletClient, ethereumClient, api, program, sendTx };
}
