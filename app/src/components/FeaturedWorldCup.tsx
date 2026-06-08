import { Link } from "react-router-dom";
import { Trophy, Check } from "lucide-react";
import { useWorldCupCandidates } from "@/hooks/useMarkets";
import { useBasketDraft } from "@/contexts/BasketContext";
import { toPct } from "@/lib/odds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Featured row: the World Cup Winner market (left) + the cup promo banner (right). */
export function FeaturedWorldCup() {
  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-[1.45fr_1fr]">
      <WinnerCard />
      <Link
        to="/explore"
        aria-label="World Cup 26 — predict and win on PolyBaskets"
        className="group relative overflow-hidden rounded-2xl ring-1 ring-primary/20 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src="/cup.png"
          alt="FIFA World Cup 26 — predict and win on PolyBaskets"
          className="h-full min-h-[180px] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>
    </div>
  );
}

function WinnerCard() {
  const { data: candidates, isLoading } = useWorldCupCandidates(4);
  const { toggleLeg, isSelected } = useBasketDraft();

  return (
    <article className="flex overflow-hidden rounded-2xl border border-border bg-card">
      {/* image panel */}
      <div className="relative hidden w-36 shrink-0 sm:block">
        {candidates?.[0]?.market.image ? (
          <img src={candidates[0].market.image} alt="" aria-hidden className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-secondary to-muted" />
        )}
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-r from-transparent to-card/90">
          <Trophy className="h-9 w-9 text-primary drop-shadow" aria-hidden />
        </div>
      </div>

      {/* content */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-primary">World Cup 26</p>
          <h3 className="text-base font-bold leading-tight">2026 FIFA World Cup Winner</h3>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded-md" />)}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {(candidates ?? []).slice(0, 3).map((c) => {
              const active = isSelected(c.market.id, "YES");
              return (
                <li key={c.market.id} className="flex items-center gap-3">
                  <span className="w-20 truncate text-sm font-medium">{c.name}</span>
                  <span className="w-10 shrink-0 font-mono text-sm tabular-nums text-primary">{toPct(c.prob)}</span>
                  <button
                    onClick={() => toggleLeg(c.market, "YES")}
                    aria-pressed={active}
                    className={cn(
                      "ml-auto flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-secondary/40 text-foreground hover:bg-secondary",
                    )}
                  >
                    {active ? <><Check className="h-3 w-3" /> Added</> : "Pick"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </article>
  );
}
