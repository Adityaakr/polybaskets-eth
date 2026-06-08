import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, ChevronRight, RefreshCw, Trophy, Clock, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLedger } from "@/contexts/LedgerContext";
import { useWallet } from "@/contexts/WalletContext";
import { BasketMarketClient, type OnchainBasket, type OnchainPosition, type OnchainSettlement } from "@/lib/varaeth";
import { fromBaseUnits } from "@/lib/varaeth/format";
import { positionMath, isClaimable } from "@/lib/positionMath";
import { useBasketSeries } from "@/hooks/useBasketSeries";
import { usePrices, usdValue, fmtUsd, fmtToken } from "@/hooks/usePrices";
import { labelFromSlug, LEG_COLORS } from "@/lib/priceHistory";
import { isChainConfigured, type Collateral } from "@/config";
import { cn } from "@/lib/utils";

interface Item {
  basket: OnchainBasket;
  position: OnchainPosition | null;
  settlement: OnchainSettlement | null;
  created: boolean;
}

const isCreator = (creator: string, addr: string) =>
  creator.replace(/^0x/, "").toLowerCase().slice(-40) === addr.replace(/^0x/, "").toLowerCase();

type Tab = "positions" | "claimable" | "created";

export default function MyBasketsPage() {
  const wallet = useWallet();
  const ledger = useLedger();
  const { data: prices } = usePrices();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("positions");

  const load = useCallback(async () => {
    if (!wallet.authenticated || !wallet.address || !isChainConfigured()) { setLoading(false); return; }
    setError(false);
    try {
      const client = new BasketMarketClient(await wallet.getSession());
      const [baskets, positions] = await Promise.all([
        client.getAllBaskets(),
        client.getPositions(wallet.address).catch(() => [] as OnchainPosition[]),
      ]);
      const posByBasket = new Map(positions.map((p) => [String(p.basket_id), p]));
      const scoped = baskets.filter((b) => isCreator(b.creator, wallet.address!) || posByBasket.has(String(b.id)));
      const settlements = await Promise.all(scoped.map((b) => client.getSettlement(b.id).catch(() => null)));
      const built: Item[] = scoped
        .map((basket, i) => ({
          basket,
          position: posByBasket.get(String(basket.id)) ?? null,
          settlement: settlements[i],
          created: isCreator(basket.creator, wallet.address!),
        }))
        .sort((a, b) => Number(b.basket.id) - Number(a.basket.id));
      setItems(built);
      ledger.refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [wallet.authenticated, wallet.address]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    load();
    const iv = setInterval(load, 10_000); // keep status / settlement / claim fresh
    return () => clearInterval(iv);
  }, [load]);

  // portfolio summary (doesn't need live odds)
  const summary = useMemo(() => {
    const withPos = items.filter((i) => i.position);
    let stakedUsd = 0, claimableUsd = 0, claimableCount = 0;
    for (const it of withPos) {
      const c = it.position!.collateral as Collateral;
      const stakeTok = Number(fromBaseUnits(it.position!.shares, c, 18));
      stakedUsd += usdValue(stakeTok, prices, c);
      if (isClaimable(it.basket, it.position, it.settlement)) {
        const { value } = positionMath(it.position!, it.settlement, 0);
        claimableUsd += usdValue(Number(fromBaseUnits(value, c, 18)), prices, c);
        claimableCount++;
      }
    }
    const depositedUsd =
      usdValue(Number(fromBaseUnits(ledger.balances.eth, "Eth", 18)), prices, "Eth") +
      usdValue(Number(fromBaseUnits(ledger.balances.wvara, "Wvara", 18)), prices, "Wvara");
    return { stakedUsd, claimableUsd, claimableCount, depositedUsd, openCount: withPos.length };
  }, [items, prices, ledger.balances]);

  const filtered = useMemo(() => {
    if (tab === "positions") return items.filter((i) => i.position);
    if (tab === "claimable") return items.filter((i) => isClaimable(i.basket, i.position, i.settlement));
    return items.filter((i) => i.created);
  }, [items, tab]);

  if (!wallet.authenticated) {
    return <Empty cta={<Button onClick={wallet.login} disabled={!wallet.enabled}>Sign in</Button>}>Sign in to see your portfolio</Empty>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portfolio</h1>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* summary cards — like a profile header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Deposited" value={fmtUsd(summary.depositedUsd)} icon={<Wallet className="h-3.5 w-3.5" />} sub="available to bet" />
        <SummaryCard label="In play" value={fmtUsd(summary.stakedUsd)} sub={`${summary.openCount} position${summary.openCount === 1 ? "" : "s"}`} />
        <SummaryCard label="Claimable" value={fmtUsd(summary.claimableUsd)} accent={summary.claimableUsd > 0} sub={`${summary.claimableCount} ready`} />
        <SummaryCard label="Baskets" value={String(items.length)} sub="created + bet" />
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 border-b border-border/60">
        {([["positions", "Positions"], ["claimable", "Claimable"], ["created", "Created"]] as [Tab, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none",
              tab === k ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l}
            {k === "claimable" && summary.claimableCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{summary.claimableCount}</span>
            )}
            {tab === k && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : error ? (
        <Empty cta={<Button onClick={load}>Try again</Button>}>Couldn't load your portfolio</Empty>
      ) : filtered.length === 0 ? (
        <Empty cta={<Button asChild><Link to="/explore">Explore markets</Link></Button>}>
          {tab === "claimable" ? "Nothing to claim yet" : tab === "created" ? "You haven't created a basket yet" : "No positions yet — build a slip to start"}
        </Empty>
      ) : (
        <div className="space-y-3">
          {filtered.map((it) => <PortfolioRow key={String(it.basket.id)} item={it} onClaimed={load} />)}
        </div>
      )}
    </div>
  );
}

function PortfolioRow({ item, onClaimed }: { item: Item; onClaimed: () => void }) {
  const ledger = useLedger();
  const { data: prices } = usePrices();
  const { basket, position, settlement } = item;
  const { data: series } = useBasketSeries(
    basket.items.map((it) => ({ slug: it.poly_slug || it.poly_market_id, outcome: it.selected_outcome, weightBps: it.weight_bps })),
  );

  const claimable = isClaimable(basket, position, settlement);
  const c = (position?.collateral ?? "Eth") as Collateral;
  const sym = c === "Eth" ? "ETH" : "wVARA";

  let valueNode: React.ReactNode = null;
  if (position) {
    const m = positionMath(position, settlement, (series?.current.basket ?? 0) * 100);
    const stakeTok = Number(fromBaseUnits(m.stake, c, 18));
    const valueTok = Number(fromBaseUnits(m.value, c, 18));
    const pnlTok = valueTok - stakeTok;
    const up = pnlTok >= 0;
    valueNode = (
      <div className="text-right">
        <p className="font-mono text-sm font-bold tabular-nums">{fmtUsd(usdValue(valueTok, prices, c))}</p>
        {!m.settled ? (
          <p className={cn("flex items-center justify-end gap-0.5 font-mono text-xs", up ? "text-success" : "text-destructive")}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {up ? "+" : ""}{stakeTok > 0 ? ((pnlTok / stakeTok) * 100).toFixed(1) : "0"}%
          </p>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">final</p>
        )}
      </div>
    );
  }

  async function claim(e: React.MouseEvent) {
    e.preventDefault();
    await ledger.claim(basket.id);
    onClaimed();
  }

  return (
    <Link
      to={`/basket/${basket.id}`}
      className="group block rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary">
          <Layers className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{basket.name || `Basket #${basket.id}`}</p>
            <StatusPill status={basket.status} />
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            #{String(basket.id)} · {basket.items.length} legs
            {position && <> · staked {fmtToken(Number(fromBaseUnits(position.shares, c, 18)), c)} {sym}</>}
          </p>
        </div>
        {valueNode}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {/* leg chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {basket.items.slice(0, 6).map((it, i) => (
          <span key={i} className="flex items-center gap-1 rounded-md bg-secondary/50 px-1.5 py-0.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
            {labelFromSlug(it.poly_slug || it.poly_market_id)}
            <span className={it.selected_outcome === "Yes" ? "text-primary" : "text-destructive"}>{it.selected_outcome === "Yes" ? "Y" : "N"}</span>
          </span>
        ))}
      </div>

      {/* status-aware action row */}
      {claimable ? (
        <Button className="mt-3 w-full gap-1.5" disabled={ledger.busy} onClick={claim}>
          <Trophy className="h-4 w-4" /> Claim {fmtToken(Number(fromBaseUnits(positionMath(position!, settlement, 0).value, c, 18)), c)} {sym}
        </Button>
      ) : position?.claimed ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-success"><Trophy className="h-3.5 w-3.5" /> Claimed</p>
      ) : basket.status === "SettlementPending" ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-warning"><Clock className="h-3.5 w-3.5" /> Settling — claim opens after the challenge window</p>
      ) : !position && item.created ? (
        <p className="mt-3 text-xs text-muted-foreground">You created this basket · no bet placed</p>
      ) : null}
    </Link>
  );
}

function SummaryCard({ label, value, sub, icon, accent }: { label: string; value: string; sub?: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", accent ? "border-primary/40 bg-primary/5" : "border-border")}>
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-bold tabular-nums", accent && "text-primary")}>{value}</p>
      {sub && <p className="font-mono text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: OnchainBasket["status"] }) {
  const map = {
    Active: { cls: "bg-primary/15 text-primary", label: "Active" },
    SettlementPending: { cls: "bg-warning/15 text-warning", label: "Settling" },
    Settled: { cls: "bg-muted text-muted-foreground", label: "Settled" },
  } as const;
  const s = map[status];
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", s.cls)}>{s.label}</span>;
}

function Empty({ children, cta }: { children: React.ReactNode; cta: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center">
      <Layers className="h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-lg font-semibold">{children}</p>
      <div className="mt-5">{cta}</div>
    </div>
  );
}
