import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
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
  const sessionRef = useRef<VaraEthSession | null>(null);

  const activeWallet = wallets.find((w) => w.address === user?.wallet?.address) ?? wallets[0];
  const address = (user?.wallet?.address ?? activeWallet?.address ?? null) as
    | `0x${string}`
    | null;
  const isEmbedded = (activeWallet?.walletClientType ?? user?.wallet?.walletClientType) === "privy";

  // invalidate cached session when the address changes
  useEffect(() => {
    sessionRef.current = null;
  }, [address]);

  const getSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    if (!address) throw new Error("Connect a wallet first.");
    const wallet = wallets.find((w) => w.address === address) ?? wallets[0];
    if (!wallet) throw new Error("No wallet available.");
    // Sign through the wallet's EIP-1193 provider for BOTH embedded and external wallets. Privy's
    // toViemAccount is just a wrapper over this same provider (it calls getEthereumProvider() then
    // personal_sign / secp256k1_sign), so there's no separate "local" signer to use. Embedded wallets
    // sign via a Privy confirmation popup (showWalletUIs); external wallets via their native prompt.
    // Both produce the EIP-191 personal_sign the Vara.eth validator expects.
    const provider = await wallet.getEthereumProvider();
    const session = await buildSession({ provider: provider as any }, address);
    sessionRef.current = session;
    return session;
  }, [address, wallets]);

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
