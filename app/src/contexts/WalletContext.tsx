import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { PrivyProvider, usePrivy, useWallets, useSendTransaction, useSignMessage } from "@privy-io/react-auth";
import { config, hoodiChain } from "@/config";
import { buildSession, type EmbeddedSigner, type VaraEthSession } from "@/lib/varaeth";

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
  const { signMessage } = useSignMessage();
  const sessionRef = useRef<VaraEthSession | null>(null);

  const activeWallet = wallets.find((w) => w.address === user?.wallet?.address) ?? wallets[0];
  const address = (user?.wallet?.address ?? activeWallet?.address ?? null) as
    | `0x${string}`
    | null;
  // Embedded = the ACTIVE wallet is the Privy email wallet. Trust the resolved wallet's own type
  // first; fall back to the user's linked wallet type ONLY when it's the same address (covers the
  // brief window where useWallets hasn't populated walletClientType yet). This deliberately does
  // NOT treat an external wallet as embedded — routing an external wallet through Privy's hooks is
  // exactly what threw "Must have a Privy wallet before signing".
  const sameAddr = user?.wallet?.address?.toLowerCase() === activeWallet?.address?.toLowerCase();
  const isEmbedded =
    (activeWallet?.walletClientType ?? (sameAddr ? user?.wallet?.walletClientType : undefined)) === "privy";

  // Invalidate the cached session when the address, the Privy bindings, or the embedded flag changes
  // (Privy can populate walletClientType a tick after the wallet appears — rebuilding on the flip
  // prevents a wrong-path session from sticking).
  useEffect(() => {
    sessionRef.current = null;
  }, [address, sendTransaction, signMessage, isEmbedded]);

  const getSession = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first.");
    // Reuse the cached session ONLY if its send path matches the current embedded detection — a
    // session built before Privy populated the wallet type would be on the wrong path.
    if (sessionRef.current && !!sessionRef.current.sendTx === isEmbedded) return sessionRef.current;

    let session: VaraEthSession;
    if (isEmbedded) {
      // Embedded (email) wallet: sign EVERYTHING through Privy's official hooks, targeting this
      // wallet explicitly via `address`. The raw EIP-1193 provider 4100s for embedded wallets
      // (it skips Privy's internal connect()); the hooks handle connect + correct wallet + encoding.
      const embedded: EmbeddedSigner = {
        address,
        // Bets (injected tx): sign the 32-byte hash. Privy detects the 0x-hex and signs it as raw
        // bytes (encoding: "hex") — identical to viem signMessage({message:{raw}}), so the
        // validator accepts it.
        signHash: async (hashHex) => {
          const { signature } = await signMessage({ message: hashHex }, { address });
          return signature as `0x${string}`;
        },
        // Deposits / approvals (value + contract txns) on Hoodi.
        sendTransaction: async (tx) => {
          const { hash } = await sendTransaction(
            { to: tx.to, data: tx.data, value: tx.value, chainId: hoodiChain.id },
            { address },
          );
          return hash;
        },
      };
      session = await buildSession({ embedded }, address);
    } else {
      // External wallet (MetaMask, etc.): everything signs through its own EIP-1193 provider with a
      // native popup, which authorizes all methods — no 4100.
      const wallet = wallets.find((w) => w.address === address) ?? wallets[0];
      if (!wallet) throw new Error("No wallet available.");
      const provider = await wallet.getEthereumProvider();
      session = await buildSession({ provider: provider as any }, address);
    }
    sessionRef.current = session;
    return session;
  }, [address, wallets, sendTransaction, signMessage, isEmbedded]);

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
        // Email OTP + external wallets. Email creates a Privy embedded wallet; we sign its bets via
        // useSignMessage and its deposits via useSendTransaction (see WalletContext getSession) —
        // the only paths the embedded wallet authorizes. The raw EIP-1193 provider 4100s for embedded
        // wallets, so we never use it for them. showWalletUIs:true shows Privy's confirm modal on
        // sign/send. Embedded wallet starts empty; user funds it via the "Fund" QR.
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
