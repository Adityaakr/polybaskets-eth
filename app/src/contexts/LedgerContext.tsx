import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "./WalletContext";
import { BasketMarketClient, type OnchainPosition, type OnchainBasket } from "@/lib/varaeth";
import { toBaseUnits } from "@/lib/varaeth/format";
import { isChainConfigured, type Collateral } from "@/config";

export interface Balances {
  eth: bigint;
  wvara: bigint;
}

interface LedgerState {
  chainReady: boolean;
  balances: Balances;
  /** Optimistic, not-yet-committed deposit amounts (per collateral). >0 = still finalizing. */
  pending: Balances;
  /** Real on-chain positions merged with optimistic (just-bet) ones, so a fresh bet shows instantly. */
  positions: OnchainPosition[];
  /** Just-created baskets not yet committed on-chain, keyed by id — lets the basket page render
   *  immediately instead of showing a "confirming…" spinner for ~30-60s. */
  optimisticBaskets: Record<string, OnchainBasket>;
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
  // Optimistic pending deposits — the tokens already moved on-chain; the ledger credit is still
  // committing (~30-60s, + relayer for wVARA). Shown immediately so the deposit feels instant,
  // and cleared automatically once the real ledger reaches the expected post-deposit total.
  const [pending, setPending] = useState<Balances>({ eth: 0n, wvara: 0n });
  const targetRef = useRef<Balances>({ eth: 0n, wvara: 0n });
  const [positions, setPositions] = useState<OnchainPosition[]>([]);
  // Optimistic positions — recorded the instant a bet pre-confirms (~1s) so the user sees their
  // stake immediately, keyed by basket id. The real on-chain position commits ~30-60s later and
  // replaces it (reconcile effect drops the optimistic entry once the real one appears).
  const [optimistic, setOptimistic] = useState<Record<string, OnchainPosition>>({});
  // Just-created baskets, shown immediately while the real one commits (~30-60s). Cleared by the
  // basket page once the committed basket loads (real always wins; a stale entry is harmless).
  const [optimisticBaskets, setOptimisticBaskets] = useState<Record<string, OnchainBasket>>({});
  const [busy, setBusy] = useState(false);

  const chainReady = isChainConfigured();

  // Effective balances = committed ledger + optimistic pending (no double-count: once the real
  // balance reaches the target, pending is dropped so effective stays equal to the real value).
  const effective = useMemo<Balances>(
    () => ({ eth: balances.eth + pending.eth, wvara: balances.wvara + pending.wvara }),
    [balances, pending],
  );

  // Real positions + any optimistic bet not yet committed (real wins on id collision).
  const mergedPositions = useMemo<OnchainPosition[]>(() => {
    const byId = new Map(positions.map((p) => [String(p.basket_id), p]));
    for (const [id, p] of Object.entries(optimistic)) if (!byId.has(id)) byId.set(id, p);
    return [...byId.values()];
  }, [positions, optimistic]);

  const addOptimisticPosition = useCallback(
    (basketId: bigint, c: Collateral, amount: bigint, indexBps: number) => {
      if (!wallet.address) return;
      setOptimistic((m) => ({
        ...m,
        [String(basketId)]: {
          basket_id: basketId, user: wallet.address as `0x${string}`, collateral: c,
          shares: amount, index_at_creation_bps: indexBps, claimed: false,
        },
      }));
    },
    [wallet.address],
  );

  const addOptimisticBasket = useCallback(
    (
      id: bigint,
      name: string,
      description: string,
      items: { poly_market_id: string; poly_slug: string; weight_bps: number; selected_outcome: "Yes" | "No" }[],
    ) => {
      if (!wallet.address) return;
      setOptimisticBaskets((m) => ({
        ...m,
        [String(id)]: {
          id, creator: wallet.address as `0x${string}`, name, description,
          items: items.map((it) => ({ ...it })),
          created_at: BigInt(Date.now()),
          status: "Active",
        },
      }));
    },
    [wallet.address],
  );

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

  // Background auto-refresh — balances/positions catch up within ~3s of an on-chain commit,
  // independent of any in-flight action poll (robustness: deposits/bets reflect even if you navigate).
  useEffect(() => {
    if (!chainReady || !wallet.authenticated || !wallet.address) return;
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [chainReady, wallet.authenticated, wallet.address, refresh]);

  // Drop an optimistic position once its real on-chain position has committed (shows up in refresh).
  useEffect(() => {
    setOptimistic((m) => {
      let changed = false;
      const next = { ...m };
      for (const p of positions) {
        if (next[String(p.basket_id)]) { delete next[String(p.basket_id)]; changed = true; }
      }
      return changed ? next : m;
    });
  }, [positions]);

  // Reconcile optimistic pending against the real ledger: once the committed balance reaches the
  // post-deposit target, drop the pending so the effective balance stays exact.
  useEffect(() => {
    setPending((p) => {
      const next = { ...p };
      if (p.eth > 0n && balances.eth >= targetRef.current.eth) next.eth = 0n;
      if (p.wvara > 0n && balances.wvara >= targetRef.current.wvara) next.wvara = 0n;
      return next.eth === p.eth && next.wvara === p.wvara ? p : next;
    });
  }, [balances]);

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
      const key = c === "Eth" ? "eth" : "wvara";
      const amt = toBaseUnits(human, c);
      const before = c === "Eth" ? balancesRef.current.eth : balancesRef.current.wvara;
      const id = toast.loading(`Confirming ${sym} deposit…`);
      setBusy(true);
      try {
        // Submit — resolves once the Ethereum tx confirms (the tokens have actually moved on-chain).
        await withClient((client) =>
          c === "Eth" ? client.depositEth(amt) : client.depositWvara(amt),
        );
      } catch (e: any) {
        toast.error(`Deposit failed`, { id, description: e?.message?.slice(0, 140) });
        setBusy(false);
        throw e;
      }
      // Optimistic: show the balance immediately. The ledger credit finalizes in the background
      // (~30-60s, + relayer for wVARA); the reconcile effect drops `pending` once it lands.
      targetRef.current = { ...targetRef.current, [key]: before + amt };
      setPending((p) => ({ ...p, [key]: amt }));
      setBusy(false);
      toast.success(
        c === "Eth" ? `${human} ETH deposited` : `${human} wVARA deposited`,
        { id, description: "Finalizing on-chain — usable to bet in a moment." },
      );
      refresh();
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
    async (basketId: bigint, c: Collateral, human: string, indexBps: number) => {
      const amt = toBaseUnits(human, c);
      await run("Place bet", (client) => client.bet(basketId, c, amt, indexBps));
      // Show the stake immediately — real position commits ~30-60s later and replaces this.
      addOptimisticPosition(basketId, c, amt, indexBps);
    },
    [run, addOptimisticPosition],
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
        // Show the stake AND the basket instantly; the real ones commit ~30-60s later and replace them.
        if (newId != null) {
          addOptimisticPosition(newId, c, toBaseUnits(human, c), indexBps);
          addOptimisticBasket(newId, name, description, items);
        }
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
    [withClient, refresh, addOptimisticPosition, addOptimisticBasket],
  );

  const value = useMemo<LedgerState>(
    () => ({ chainReady, balances: effective, pending, positions: mergedPositions, optimisticBaskets, busy, refresh, deposit, withdraw, placeBet, claim, createBasket, placeSlip }),
    [chainReady, effective, pending, mergedPositions, optimisticBaskets, busy, refresh, deposit, withdraw, placeBet, claim, createBasket, placeSlip],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
