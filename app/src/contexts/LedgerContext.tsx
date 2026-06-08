import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "./WalletContext";
import { BasketMarketClient, type OnchainPosition } from "@/lib/varaeth";
import { toBaseUnits } from "@/lib/varaeth/format";
import { isChainConfigured, type Collateral } from "@/config";

export interface Balances {
  eth: bigint;
  wvara: bigint;
}

interface LedgerState {
  chainReady: boolean;
  balances: Balances;
  positions: OnchainPosition[];
  busy: boolean;
  refresh: () => Promise<void>;
  deposit: (c: Collateral, human: string) => Promise<void>;
  withdraw: (c: Collateral, human: string) => Promise<void>;
  placeBet: (basketId: bigint, c: Collateral, human: string, indexBps: number) => Promise<void>;
  claim: (basketId: bigint) => Promise<void>;
  createBasket: (
    name: string,
    description: string,
    items: { poly_market_id: string; poly_slug: string; weight_bps: number; selected_outcome: "Yes" | "No" }[],
  ) => Promise<bigint | null>;
  /** Create a basket AND place the bet in one pre-confirmed flow. Returns the new basket id. */
  placeSlip: (
    name: string,
    description: string,
    items: { poly_market_id: string; poly_slug: string; weight_bps: number; selected_outcome: "Yes" | "No" }[],
    c: Collateral,
    human: string,
    indexBps: number,
    opts?: { onView?: (id: bigint) => void },
  ) => Promise<bigint | null>;
}

const Ctx = createContext<LedgerState | null>(null);

export const useLedger = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLedger must be used within <LedgerProvider>");
  return c;
};

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [balances, setBalances] = useState<Balances>({ eth: 0n, wvara: 0n });
  const balancesRef = useRef(balances);
  useEffect(() => { balancesRef.current = balances; }, [balances]);
  const [positions, setPositions] = useState<OnchainPosition[]>([]);
  const [busy, setBusy] = useState(false);

  const chainReady = isChainConfigured();

  const withClient = useCallback(
    async <T,>(fn: (c: BasketMarketClient) => Promise<T>): Promise<T> => {
      const session = await wallet.getSession();
      return fn(new BasketMarketClient(session));
    },
    [wallet],
  );

  const refresh = useCallback(async () => {
    if (!chainReady || !wallet.address) return;
    try {
      await withClient(async (client) => {
        const [eth, wvara, pos] = await Promise.all([
          client.getBalance(wallet.address!, "Eth").catch(() => 0n),
          client.getBalance(wallet.address!, "Wvara").catch(() => 0n),
          client.getPositions(wallet.address!).catch(() => [] as OnchainPosition[]),
        ]);
        setBalances({ eth, wvara });
        setPositions(pos);
      });
    } catch (e: any) {
      // chain not ready / IDL missing — keep UI calm
      console.warn("[ledger] refresh skipped:", e?.message);
    }
  }, [chainReady, wallet.address, withClient]);

  const run = useCallback(
    async (label: string, fn: (c: BasketMarketClient) => Promise<unknown>) => {
      setBusy(true);
      const id = toast.loading(`${label}…`);
      try {
        await withClient(fn);
        toast.success(`${label} confirmed`, { id });
        await refresh();
      } catch (e: any) {
        toast.error(`${label} failed`, { id, description: e?.message?.slice(0, 140) });
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [withClient, refresh],
  );

  const deposit = useCallback(
    async (c: Collateral, human: string) => {
      const sym = c === "Eth" ? "ETH" : "wVARA";
      const before = c === "Eth" ? balancesRef.current.eth : balancesRef.current.wvara;
      // Step 1: submit (returns once the Ethereum tx confirms — no blocking on Vara.eth reply).
      const id = toast.loading(`Submitting ${sym} deposit…`);
      setBusy(true);
      try {
        await withClient((client) => {
          const amt = toBaseUnits(human, c);
          return c === "Eth" ? client.depositEth(amt) : client.depositWvara(amt);
        });
      } catch (e: any) {
        toast.error(`Deposit failed`, { id, description: e?.message?.slice(0, 140) });
        setBusy(false);
        throw e;
      }
      // Step 2: poll the ledger until the balance reflects it (validator commit + relayer for wVARA).
      toast.loading(c === "Eth" ? "Crediting your balance…" : "Bridging wVARA to your balance…", { id });
      let credited = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        await refresh();
        const now = c === "Eth" ? balancesRef.current.eth : balancesRef.current.wvara;
        if (now > before) { credited = true; break; }
      }
      setBusy(false);
      if (credited) toast.success(`${sym} deposited · ready to bet`, { id });
      else toast.message(`${sym} deposit submitted — balance will update shortly`, { id });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [withClient, refresh],
  );

  const withdraw = useCallback(
    async (c: Collateral, human: string) => {
      const sym = c === "Eth" ? "ETH" : "wVARA";
      await run(`Withdraw ${human} ${sym}`, (client) => {
        const amt = toBaseUnits(human, c);
        return c === "Eth" ? client.withdrawEth(amt) : client.withdrawWvara(amt);
      });
      if (c === "Wvara") {
        toast.message("wVARA withdrawal queued — the relayer is releasing it to your wallet.");
      }
    },
    [run],
  );

  const placeBet = useCallback(
    (basketId: bigint, c: Collateral, human: string, indexBps: number) =>
      run("Place bet", (client) =>
        client.bet(basketId, c, toBaseUnits(human, c), indexBps),
      ).then(() => undefined),
    [run],
  );

  const claim = useCallback(
    (basketId: bigint) => run("Claim", (client) => client.claim(basketId)).then(() => undefined),
    [run],
  );

  const createBasket = useCallback<LedgerState["createBasket"]>(
    async (name, description, items) => {
      setBusy(true);
      const id = toast.loading("Creating basket…");
      try {
        const newId = await withClient((client) => client.createBasket(name, description, items));
        // pre-confirmed (~1s) — the basket commits on-chain shortly after
        toast.success("Basket created · confirming on-chain", { id });
        return newId ?? null;
      } catch (e: any) {
        toast.error("Create basket failed", { id, description: e?.message?.slice(0, 140) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [withClient],
  );

  const placeSlip = useCallback<LedgerState["placeSlip"]>(
    async (name, description, items, c, human, indexBps, opts) => {
      setBusy(true);
      const id = toast.loading("Placing your slip…");
      try {
        const newId = await withClient((client) =>
          client.createAndBet(name, description, items, c, toBaseUnits(human, c), indexBps, (msg) =>
            toast.loading(msg, { id }),
          ),
        );
        toast.success("⚡ Slip placed", {
          id,
          description: "Your bet is in — it'll appear in My Baskets shortly.",
          action: newId != null && opts?.onView ? { label: "View", onClick: () => opts.onView!(newId) } : undefined,
        });
        refresh();
        return newId ?? null;
      } catch (e: any) {
        toast.error("Couldn't place slip", { id, description: e?.message?.slice(0, 140) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [withClient, refresh],
  );

  const value = useMemo<LedgerState>(
    () => ({ chainReady, balances, positions, busy, refresh, deposit, withdraw, placeBet, claim, createBasket, placeSlip }),
    [chainReady, balances, positions, busy, refresh, deposit, withdraw, placeBet, claim, createBasket, placeSlip],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
