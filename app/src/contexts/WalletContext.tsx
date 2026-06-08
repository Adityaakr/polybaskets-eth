import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useWallets, useSendTransaction } from "@privy-io/react-auth";
import { config, hoodiChain } from "@/config";
import { buildSession, type VaraEthSession } from "@/lib/varaeth";

interface WalletState {
  /** Privy configured at all? */
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | null;
  /** True for the Privy embedded wallet (email/social) — starts empty, must be funded. */
  isEmbedded: boolean;
  login: () => void;
  logout: () => void;
  /** Lazily-built Vara.eth session (null until wallet ready + chain configured). */
  getSession: () => Promise<VaraEthSession>;
}

const WalletContext = createContext<WalletState | null>(null);

export const useWallet = () => {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
};

/** Privy-backed implementation (only mounted when an appId is configured). */
function PrivyWallet({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const sessionRef = useRef<VaraEthSession | null>(null);

  const activeWallet = wallets.find((w) => w.address === user?.wallet?.address) ?? wallets[0];
  const address = (user?.wallet?.address ?? activeWallet?.address ?? null) as
    | `0x${string}`
    | null;
  const isEmbedded = (activeWallet?.walletClientType ?? user?.wallet?.walletClientType) === "privy";

  // Invalidate the cached session when the address, the Privy sendTransaction binding, OR the
  // embedded flag changes. The embedded flag matters because Privy can populate walletClientType a
  // tick AFTER the wallet appears — without this, a session built in that window has no sendTx and
  // gets cached, so every deposit falls back to the raw provider (4100). Rebuilding on the flip fixes it.
  useEffect(() => {
    sessionRef.current = null;
  }, [address, sendTransaction, isEmbedded]);

  const getSession = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first.");
    const wallet = wallets.find((w) => w.address === address) ?? wallets[0];
    if (!wallet) throw new Error("No wallet available.");
    // VALUE/CONTRACT txns (deposits, approvals): embedded wallets reject the raw-provider
    // eth_sendTransaction with 4100, so route them through Privy's useSendTransaction instead.
    // External wallets leave sendTx undefined and use the viem walletClient (native popup).
    // Detect embedded robustly — the resolved wallet entry can momentarily lack walletClientType,
    // so also trust the logged-in user's wallet type and the component-level isEmbedded flag.
    const isEmbeddedWallet =
      wallet.walletClientType === "privy" ||
      user?.wallet?.walletClientType === "privy" ||
      isEmbedded;
    // Reuse the cached session ONLY if its send path matches the current embedded detection. A
    // session built before Privy populated the wallet type would lack sendTx; never reuse that for
    // an embedded wallet (that's the intermittent 4100 — a stale wrong session getting cached).
    if (sessionRef.current && !!sessionRef.current.sendTx === isEmbeddedWallet) return sessionRef.current;
    // Sign through the wallet's EIP-1193 provider for BOTH embedded and external wallets (personal_sign).
    const provider = await wallet.getEthereumProvider();
    const sendTx = isEmbeddedWallet
      ? async (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }) => {
          const { hash } = await sendTransaction(
            {
              to: tx.to,
              data: tx.data,
              value: tx.value !== undefined ? (`0x${tx.value.toString(16)}` as `0x${string}`) : undefined,
              chainId: hoodiChain.id,
            },
            { uiOptions: { showWalletUIs: true } },
          );
          return hash;
        }
      : undefined;
    // eslint-disable-next-line no-console
    console.info("[wallet] session built", { embedded: isEmbeddedWallet, hasSendTx: !!sendTx, walletClientType: wallet.walletClientType });
    const session = await buildSession({ provider: provider as any }, address, sendTx);
    sessionRef.current = session;
    return session;
  }, [address, wallets, sendTransaction, isEmbedded, user]);

  const value = useMemo<WalletState>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      address,
      isEmbedded,
      login,
      logout,
      getSession,
    }),
    [ready, authenticated, address, isEmbedded, login, logout, getSession],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Stub used when VITE_PRIVY_APP_ID is not set — app still runs, login disabled. */
function StubWallet({ children }: { children: React.ReactNode }) {
  const value = useMemo<WalletState>(
    () => ({
      enabled: false,
      ready: true,
      authenticated: false,
      address: null,
      isEmbedded: false,
      login: () => {},
      logout: () => {},
      getSession: async () => {
        throw new Error("Privy is not configured (set VITE_PRIVY_APP_ID).");
      },
    }),
    [],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!config.privyAppId) return <StubWallet>{children}</StubWallet>;
  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        // Email OTP + external wallets. Email creates a Privy embedded wallet that we drive as a viem
        // LOCAL account (toViemAccount in getSession) — so bets AND deposits sign SILENTLY, no popup,
        // never touching the raw EIP-1193 provider (which is what threw 4100 with showWalletUIs:false).
        // showWalletUIs stays true purely as a safety net for any incidental provider use; the silent
        // path doesn't rely on it. Embedded wallet starts empty; user funds it via the "Fund" QR.
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          createOnLogin: "users-without-wallets",
          showWalletUIs: true,
        },
        // Coinbase Smart Wallet doesn't support Hoodi — use EOA-only to avoid unsupported-chain noise.
        externalWallets: { coinbaseWallet: { connectionOptions: "eoaOnly" } },
        defaultChain: hoodiChain,
        supportedChains: [hoodiChain],
        appearance: {
          theme: "dark",
          accentColor: "#00ff00",
          logo: undefined,
        },
      }}
    >
      <PrivyWallet>{children}</PrivyWallet>
    </PrivyProvider>
  );
}
