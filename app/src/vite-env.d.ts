/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ETHEREUM_RPC?: string;
  readonly VITE_VARA_ETH_RPC?: string;
  readonly VITE_ROUTER_ADDRESS?: string;
  readonly VITE_PROGRAM_ID?: string;
  readonly VITE_WVARA_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_GAMMA_PROXY?: string;
  readonly VITE_WORLD_CUP_WINNER_SLUG?: string;
  readonly VITE_WORLD_CUP_TAG_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: any;
}
