import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Layers, Loader2, TrendingUp, Trophy, Clock, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet } from "@/contexts/WalletContext";
import { useLedger } from "@/contexts/LedgerContext";
import { BasketMarketClient, type OnchainBasket, type OnchainSettlement, type OnchainPosition } from "@/lib/varaeth";
import { fromBaseUnits } from "@/lib/varaeth/format";
import { isChainConfigured, type Collateral } from "@/config";
import { cn } from "@/lib/utils";
import BasketChart from "@/components/BasketChart";
import { useBasketSeries } from "@/hooks/useBasketSeries";
import { usePrices, usdValue, fmtUsd, fmtToken } from "@/hooks/usePrices";
import { labelFromSlug, LEG_COLORS } from "@/lib/priceHistory";

export default function BasketPage() {
  const { id } = useParams();
  const wallet = useWallet();
  const [basket, setBasket] = useState<OnchainBasket | null>(null);
  const [settlement, setSettlement] = useState<OnchainSettlement | null>(null);
  const [position, setPosition] = useState<OnchainPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isChainConfigured() || !id) {
        setLoading(false);
        return;
      }
      const bid = BigInt(id);
      let client: BasketMarketClient;
      try {
        client = new BasketMarketClient(await wallet.getSession());
      } catch {
        if (alive) setLoading(false);
        return;
      }
      // Poll: a freshly-created basket isn't queryable for ~30-60s (commit latency).
      for (let i = 0; alive; i++) {
        const [b, s, positions] = await Promise.all([
          client.getBasket(bid).catch(() => null),
          client.getSettlement(bid).catch(() => null),
          wallet.address ? client.getPositions(wallet.address).catch(() => []) : Promise.resolve([]),
        ]);
        if (!alive) return;
        setSettlement(s);
        setPosition(positions.find((p) => String(p.basket_id) === String(bid)) ?? null);
        if (b) { setBasket(b); setLoading(false); setConfirming(false); }
        else { setLoading(false); setConfirming(i < 30); } // ~90s grace before "not found"
        if (b && (b.status === "Settled" || i > 40)) break; // stop once settled or after enough polls
        await new Promise((r) => setTimeout(r, b ? 8000 : 3000));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, wallet]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="gap-1">
        <Link to="/baskets">
          <ArrowLeft className="h-4 w-4" /> My baskets
        </Link>
      </Button>

      {loading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !basket && confirming ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 font-semibold">Confirming your slip on-chain…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your bet is pre-confirmed. The basket settles onto the chain in ~30–60s — this updates automatically.
          </p>
        </div>
      ) : !basket ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">Basket #{id}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isChainConfigured()
              ? "Couldn't load this basket from chain yet."
              : "Connect the deployed program (set env) to load on-chain baskets."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{basket.name}</h1>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                #{String(basket.id)} · {basket.items.length} legs
              </p>
            </div>
            <StatusPill status={basket.status} />
          </div>

          {/* the user's live position — stake, value, P&L, claim/settlement */}
          <PositionPanel basket={basket} position={position} settlement={settlement} />

          {/* combined probability chart — real Polymarket history */}
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Probability history</h2>
              <span className="text-xs text-muted-foreground">· combined basket vs. each leg</span>
            </div>
            <BasketChart
              legs={basket.items.map((it) => ({
                slug: it.poly_slug || it.poly_market_id,
                outcome: it.selected_outcome,
                weightBps: it.weight_bps,
              }))}
            />
          </div>

          {/* legs */}
          <div className="rounded-2xl border border-border bg-card">
            <p className="border-b border-border/60 px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Legs
            </p>
            <ul className="divide-y divide-border/60">
              {basket.items.map((it, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {labelFromSlug(it.poly_slug || it.poly_market_id)}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-bold",
                      it.selected_outcome === "Yes" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {it.selected_outcome.toUpperCase()}
                  </span>
                  <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round(it.weight_bps / 100)}%
                  </span>
                </li>
              ))}
            </ul>
            {settlement?.status === "Finalized" && (
              <div className="border-t border-border/60 px-5 py-3 text-sm text-success">
                Settled · index {(settlement.index_bps / 100).toFixed(2)}% — claim from My Baskets.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionPanel({
  basket, position, settlement,
}: { basket: OnchainBasket; position: OnchainPosition | null; settlement: OnchainSettlement | null }) {
  const ledger = useLedger();
  const { data: prices } = usePrices();
  const { data: series } = useBasketSeries(
    basket.items.map((it) => ({ slug: it.poly_slug || it.poly_market_id, outcome: it.selected_outcome, weightBps: it.weight_bps })),
  );

  if (!position) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-4 text-sm text-muted-foreground">
        You don't have a bet on this basket yet.
      </div>
    );
  }

  const c = position.collateral as Collateral;
  const sym = c === "Eth" ? "ETH" : "wVARA";
  const entryBps = position.index_at_creation_bps || 1;
  const stakeTok = Number(fromBaseUnits(position.shares, c, 18));
  const maxMult = 10000 / entryBps;
  const maxPayoutTok = stakeTok * maxMult;

  // live mark-to-market index from real Polymarket prices (Active), or the settled index
  const liveBps = settlement ? settlement.index_bps : Math.round((series?.current.basket ?? 0) * 100);
  const valueTok = stakeTok * (liveBps / entryBps);
  const pnlTok = valueTok - stakeTok;
  const pnlPct = stakeTok > 0 ? (pnlTok / stakeTok) * 100 : 0;
  const up = pnlTok >= 0;

  const settled = basket.status === "Settled" && settlement?.status === "Finalized";
  const pending = basket.status === "SettlementPending";
  const claimable = settled && !position.claimed;

  const challengeMsLeft = settlement ? Number(settlement.challenge_deadline) - Date.now() : 0;
  const hrs = Math.max(0, Math.floor(challengeMsLeft / 3_600_000));
  const mins = Math.max(0, Math.floor((challengeMsLeft % 3_600_000) / 60_000));

  const valueLabel = settled ? "Final payout" : pending ? "Projected payout" : "Current value";

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your position</h2>
        <span className="font-mono text-xs text-muted-foreground">×{maxMult.toFixed(2)} max</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Staked">
          <span className="font-mono text-lg font-bold tabular-nums">{fmtToken(stakeTok, c)} {sym}</span>
          <span className="font-mono text-xs text-muted-foreground">{fmtUsd(usdValue(stakeTok, prices, c))}</span>
        </Stat>

        <Stat label={valueLabel}>
          <span className="font-mono text-lg font-bold tabular-nums">{fmtToken(valueTok, c)} {sym}</span>
          <span className="font-mono text-xs text-muted-foreground">{fmtUsd(usdValue(valueTok, prices, c))}</span>
          {!settled && (
            <span className={cn("mt-0.5 flex items-center gap-0.5 font-mono text-xs font-medium", up ? "text-success" : "text-destructive")}>
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {up ? "+" : ""}{pnlPct.toFixed(1)}% ({up ? "+" : ""}{fmtUsd(usdValue(pnlTok, prices, c))})
            </span>
          )}
        </Stat>

        <Stat label="Max payout · all hit">
          <span className="font-mono text-lg font-bold tabular-nums text-primary">{fmtToken(maxPayoutTok, c)} {sym}</span>
          <span className="font-mono text-xs text-muted-foreground">{fmtUsd(usdValue(maxPayoutTok, prices, c))}</span>
        </Stat>
      </div>

      {/* status-aware action / message */}
      <div className="mt-4 border-t border-border/60 pt-4">
        {claimable ? (
          <Button className="w-full gap-1.5" disabled={ledger.busy} onClick={() => ledger.claim(basket.id)}>
            <Trophy className="h-4 w-4" /> Claim {fmtToken(valueTok, c)} {sym} ({fmtUsd(usdValue(valueTok, prices, c))})
          </Button>
        ) : position.claimed ? (
          <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-success">
            <Trophy className="h-4 w-4" /> Claimed {fmtToken(valueTok, c)} {sym}
          </p>
        ) : pending ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-warning">
            <Clock className="h-4 w-4" /> Settlement proposed · index {(liveBps / 100).toFixed(1)}% · claim in {hrs}h {mins}m
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Live position · marked against real odds. Settles & becomes claimable once all legs resolve.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
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
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
