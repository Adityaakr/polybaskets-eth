import { Check } from "lucide-react";
import type { PolymarketMarket } from "@/types/polymarket";
import type { Outcome } from "@/types/basket";
import { getOutcomeProbabilities } from "@/lib/polymarket";
import { toCents, fmtOdds } from "@/lib/odds";
import { cn } from "@/lib/utils";
import { useBasketDraft } from "@/contexts/BasketContext";

export function MarketCard({ market }: { market: PolymarketMarket }) {
  const { toggleLeg, isSelected } = useBasketDraft();
  const probs = getOutcomeProbabilities(market);
  const selectedYes = isSelected(market.id, "YES");
  const selectedNo = isSelected(market.id, "NO");
  const selected = selectedYes || selectedNo;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-[transform,box-shadow,border-color] duration-200",
        selected
          ? "border-primary/60 shadow-primary"
          : "border-border hover:-translate-y-0.5 hover:border-border/90 hover:shadow-card",
      )}
    >
      <div className="flex items-start gap-3">
        {market.image ? (
          <img
            src={market.image}
            alt=""
            aria-hidden
            className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-border"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-lg bg-secondary" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{market.question}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {market.category || "Market"}
            {market.volume ? <> · ${compact(market.volume)} Vol</> : null}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <OutcomeButton label="Yes" cents={toCents(probs.YES)} odds={fmtOdds(probs.YES)} active={selectedYes} tone="primary" onClick={() => toggleLeg(market, "YES" as Outcome)} />
        <OutcomeButton label="No" cents={toCents(probs.NO)} odds={fmtOdds(probs.NO)} active={selectedNo} tone="destructive" onClick={() => toggleLeg(market, "NO" as Outcome)} />
      </div>
    </div>
  );
}

function OutcomeButton({
  label, cents, odds, active, tone, onClick,
}: {
  label: string; cents: string; odds: string; active: boolean;
  tone: "primary" | "destructive"; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        active
          ? tone === "primary"
            ? "border-primary bg-primary/15 text-primary"
            : "border-destructive bg-destructive/15 text-destructive"
          : "border-border bg-secondary/40 text-foreground hover:border-border/90 hover:bg-secondary",
      )}
    >
      <span>
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
        <span className="ml-2 font-mono text-sm tabular-nums">{cents}</span>
      </span>
      <span className="font-mono text-xs tabular-nums opacity-70">{odds}</span>
      {active && (
        <span className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

function compact(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
