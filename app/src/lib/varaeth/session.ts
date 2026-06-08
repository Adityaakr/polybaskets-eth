import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Account,
  type PublicClient,
  type WalletClient,
} from "viem";
import { EthereumClient, VaraEthApi, WsVaraEthProvider } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { config, hoodiChain, HOODI_CHAIN_ID_HEX } from "@/config";

/** Anything that looks like an EIP-1193 provider (Privy embedded or external wallet). */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

export interface VaraEthSession {
  address: `0x${string}`;
  publicClient: PublicClient;
  walletClient: WalletClient;
  ethereumClient: EthereumClient;
  api: VaraEthApi;
  program: SailsProgram;
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
 *  - `account` (Privy embedded wallet via toViemAccount): a viem LOCAL account that signs messages
 *    AND transactions silently — no popup, no raw-provider call. Sends broadcast over http(). This
 *    is the no-popup email-wallet path (createInjectedTransaction's personal_sign is signed locally).
 *  - `provider` (external wallet, e.g. MetaMask): EIP-1193; signs with the wallet's own native popup.
 */
export async function buildSession(
  source: { provider: Eip1193; account?: undefined } | { account: Account; provider?: undefined },
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

  // Embedded (local account): sign locally, broadcast over http — fully silent.
  // External (provider): switch to Hoodi, sign + broadcast through the wallet (native popup).
  let walletClient: WalletClient;
  if (source.account) {
    walletClient = createWalletClient({
      account: source.account,
      chain: hoodiChain,
      transport: http(config.ethRpc),
    });
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

  return { address, publicClient, walletClient, ethereumClient, api, program };
}
