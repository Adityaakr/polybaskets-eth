import { useWorldCupMatches } from "@/hooks/useMarkets";
import type { WorldCupMatch } from "@/lib/worldCup";
import { useBasketDraft } from "@/contexts/BasketContext";
import { toCents } from "@/lib/odds";
import { flagUrl } from "@/lib/flags";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Featured row of real World Cup team matches — each outcome (Win / Draw / Win) is an addable leg. */
export function WorldCupMatches() {
  const { data: matches, isLoading } = useWorldCupMatches(9);

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    );
  }
  if (!matches?.length) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {matches.map((m) => <MatchCard key={m.title} match={m} />)}
    </div>
  );
}

/** Small circular national flag with a graceful fallback. */
function Flag({ name, className }: { name: string; className?: string }) {
  const url = flagUrl(name);
  if (!url) {
    return (
      <span className={cn("grid place-items-center rounded-full bg-secondary text-[10px]", className)} aria-hidden>
        ⚽
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      className={cn("rounded-full object-cover ring-1 ring-border", className)}
    />
  );
}

function MatchCard({ match }: { match: WorldCupMatch }) {
  const { toggleLeg, isSelected } = useBasketDraft();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center gap-2.5">
        {/* overlapping team flags */}
        <div className="flex shrink-0 items-center" aria-hidden>
          <Flag name={match.teamA} className="h-8 w-8" />
          <Flag name={match.teamB} className="-ml-2 h-8 w-8" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{match.title}</p>
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">World Cup 26 · Match</p>
        </div>
      </div>

      <div className={cn("grid gap-2", match.outcomes.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {match.outcomes.map((o) => {
          const active = isSelected(o.market.id, "YES");
          const isDraw = o.label === "Draw";
          return (
            <button
              key={o.market.id}
              onClick={() => toggleLeg(o.market, "YES")}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                active
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-secondary/40 hover:border-border/90 hover:bg-secondary",
              )}
            >
              <span className="flex items-center gap-1">
                {isDraw ? (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-muted text-[9px]" aria-hidden>=</span>
                ) : (
                  <Flag name={o.label} className="h-4 w-4" />
                )}
                <span className="line-clamp-1 text-xs font-medium">{o.label}</span>
              </span>
              <span className="font-mono text-sm font-bold tabular-nums">{toCents(o.prob)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
