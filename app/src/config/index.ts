import { defineChain } from "viem";

/** Hoodi testnet — Vara.eth settlement layer (per docs/10-env-and-config.md). */
export const HOODI_CHAIN_ID = 560048;
export const HOODI_CHAIN_ID_HEX = "0x88bb0";

const env = import.meta.env;

export const config = {
  ethRpc: env.VITE_ETHEREUM_RPC || "https://hoodi-reth-rpc.gear-tech.io",
  varaEthWs: (env.VITE_VARA_ETH_RPC ||
    "wss://hoodi-reth-rpc.gear-tech.io/ws") as `ws://${string}` | `wss://${string}`,
  routerAddress: (env.VITE_ROUTER_ADDRESS || "") as `0x${string}`,
  programId: (env.VITE_PROGRAM_ID || "") as `0x${string}`,
  wvaraAddress: (env.VITE_WVARA_ADDRESS || "") as `0x${string}`,
  /** WvaraVault — custodies real wVARA on Hoodi; deposits/withdrawals bridge through it. */
  wvaraVault: (env.VITE_WVARA_VAULT || "") as `0x${string}`,
  chainId: Number(env.VITE_CHAIN_ID || HOODI_CHAIN_ID),
  privyAppId: env.VITE_PRIVY_APP_ID || "",
  worldCup: {
    // Defaults resolved live from Gamma: the winner event + the "2026 FIFA World Cup" tag.
    winnerSlug: env.VITE_WORLD_CUP_WINNER_SLUG || "world-cup-winner",
    tagId: env.VITE_WORLD_CUP_TAG_ID ? Number(env.VITE_WORLD_CUP_TAG_ID) : 102350,
  },
};

/** True only when the on-chain program is configured. UI degrades gracefully otherwise. */
export const isChainConfigured = () =>
  Boolean(config.routerAddress && config.programId);

export const hoodiChain = defineChain({
  id: HOODI_CHAIN_ID,
  name: "Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.ethRpc] } },
  blockExplorers: {
    default: { name: "Hoodi Etherscan", url: "https://hoodi.etherscan.io" },
  },
});

/** Collateral kinds the BasketMarket ledger supports. */
export type Collateral = "Eth" | "Wvara";

export const COLLATERALS: {
  key: Collateral;
  label: string;
  symbol: string;
  decimals: number;
}[] = [
  { key: "Eth", label: "Ether", symbol: "ETH", decimals: 18 },
  { key: "Wvara", label: "Wrapped VARA", symbol: "wVARA", decimals: 12 },
];

export const collateralMeta = (c: Collateral) =>
  COLLATERALS.find((x) => x.key === c)!;
