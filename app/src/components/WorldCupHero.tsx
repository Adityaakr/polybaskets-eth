import { Trophy, Plus, Check } from "lucide-react";
import { useWorldCupCandidates, useWorldCupLegs } from "@/hooks/useMarkets";
import { getOutcomeProbabilities } from "@/lib/polymarket";
import { toPct, toCents, fmtOdds } from "@/lib/odds";
import { useBasketDraft } from "@/contexts/BasketContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function WorldCupHero() {
  const { data: candidates, isLoading: loadingCands } = useWorldCupCandidates(10);
  const { data: legs, isLoading: loadingLegs } = useWorldCupLegs(8);
  const { toggleLeg, isSelected } = useBasketDraft();

  const totalVol = (candidates ?? []).reduce((s, c) => s + (c.market.volume ?? 0), 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card via-card to-secondary/40 shadow-card">
      <div className="flex flex-col gap-1 border-b border-border/60 px-5 py-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-extrabold leading-none">World Cup 26</h1>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              build your slip · bet gasless on vara.eth
            </p>
          </div>
        </div>
        {totalVol > 0 && (
          <span className="font-mono text-xs text-muted-foreground md:ml-auto">
            ${(totalVol / 1e6).toFixed(0)}M volume · live odds
          </span>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        {/* Tournament winner — ranked candidates, each an addable YES leg */}
        <div className="border-b border-border/60 p-5 md:border-b-0 md:border-r">
          <p className="mb-3 text-sm font-semibold">To win the tournament</p>
          {loadingCands ? (
            <SkeletonRows />
          ) : candidates && candidates.length ? (
            <ul className="space-y-1">
              {candidates.map((c) => {
                const active = isSelected(c.market.id, "YES");
                return (
                  <li key={c.market.id}>
                    <button
                      onClick={() => toggleLeg(c.market, "YES")}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-all",
                        active ? "bg-primary/10" : "hover:bg-secondary/60",
                      )}
                    >
                      {c.market.image && (
                        <img src={c.market.image} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-border" loading="lazy" />
                      )}
                      <span className="w-24 truncate text-sm font-medium">{c.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.min(100, c.prob * 100)}%` }} />
                      </div>
                      <span className="w-10 text-right font-mono text-sm tabular-nums text-primary">{toPct(c.prob)}</span>
                      <span className={cn("grid h-5 w-5 place-items-center rounded-full", active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                        {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>Winner market unavailable right now.</Empty>
          )}
        </div>

        {/* Match / progression markets */}
        <div className="p-5">
          <p className="mb-3 text-sm font-semibold">Matches &amp; milestones</p>
          {loadingLegs ? (
            <SkeletonRows />
          ) : legs && legs.length ? (
            <ul className="space-y-1.5">
              {legs.slice(0, 6).map((m) => {
                const probs = getOutcomeProbabilities(m);
                const active = isSelected(m.id, "YES");
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => toggleLeg(m, "YES")}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all",
                        active ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/30 hover:bg-secondary",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.question}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{toCents(probs.YES)}</span>
                      <span className="font-mono text-xs tabular-nums opacity-70">{fmtOdds(probs.YES)}</span>
                      <span className={cn("grid h-5 w-5 place-items-center rounded-full", active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>
                        {active ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No match markets found yet.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

const SkeletonRows = () => (
  <div className="space-y-2">
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className="h-9 rounded-md" />
    ))}
  </div>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);
