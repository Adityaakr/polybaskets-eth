import { useMemo } from "react";
import { Plus, Check, TrendingUp, Trophy, Flame } from "lucide-react";
import type { PolymarketMarket } from "@/types/polymarket";
import { useWorldCupCandidates, useWorldCupLegs } from "@/hooks/useMarkets";
import { getOutcomeProbabilities } from "@/lib/polymarket";
import { basketMaxMultiplier, fmtMultiplier } from "@/lib/odds";
import { useBasketDraft } from "@/contexts/BasketContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Suggestion {
  key: string;
  title: string;
  blurb: string;
  icon: typeof Trophy;
  accent: "primary" | "accent";
  legs: { market: PolymarketMarket; label: string }[];
}

export function SuggestedBaskets() {
  const { data: candidates, isLoading: l1 } = useWorldCupCandidates(20);
  const { data: legs, isLoading: l2 } = useWorldCupLegs(40);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!candidates?.length) return [];
    const fav = candidates.slice(0, 3).map((c) => ({ market: c.market, label: c.name }));
    // true long shots: lowest-probability nations (tail of the sorted list)
    const longshots = candidates
      .filter((c) => c.prob > 0.005 && c.prob < 0.07)
      .slice(-3)
      .reverse()
      .map((c) => ({ market: c.market, label: c.name }));
    // progression markets only (reach/advance/knockout stages)
    const milestones = (legs ?? [])
      .filter((m) => /\b(advance|reach|knockout|quarter|round of 16|semi|final|group [a-l] winner)\b/i.test(m.question))
      .slice(0, 3)
      .map((m) => ({ market: m, label: shortQ(m.question) }));
    const out: Suggestion[] = [];
    if (fav.length) out.push({ key: "fav", title: "World Cup Favourites", blurb: "The three most-backed nations to lift the trophy.", icon: Trophy, accent: "primary", legs: fav });
    if (longshots.length >= 2) out.push({ key: "long", title: "Long-Shot Lottery", blurb: "Underdogs with the fattest multipliers.", icon: Flame, accent: "accent", legs: longshots });
    if (milestones.length >= 2) out.push({ key: "ms", title: "Knockout Run", blurb: "Nations to go deep into the tournament.", icon: TrendingUp, accent: "primary", legs: milestones });
    return out;
  }, [candidates, legs]);

  if (l1 || l2) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
      </div>
    );
  }
  if (!suggestions.length) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {suggestions.map((s) => <SuggestionCard key={s.key} s={s} />)}
    </div>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  const { toggleLeg, isSelected, setName } = useBasketDraft();
  const Icon = s.icon;
  const probs = s.legs.map((l) => getOutcomeProbabilities(l.market).YES);
  const weightBps = Math.round(10000 / s.legs.length);
  const legs = probs.map((prob) => ({ prob, weightBps }));
  const allAdded = s.legs.every((l) => isSelected(l.market.id, "YES"));
  const heroImg = s.legs.find((l) => l.market.image)?.market.image;

  const addAll = () => {
    s.legs.forEach((l) => {
      if (!isSelected(l.market.id, "YES")) toggleLeg(l.market, "YES");
    });
    setName(s.title);
  };

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-card">
      {/* image header */}
      <div className="relative h-24 overflow-hidden">
        {heroImg ? (
          <img src={heroImg} alt="" className="h-full w-full object-cover opacity-60 transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-secondary to-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/70 to-transparent" />
        <span className={cn(
          "absolute right-3 top-3 rounded-full px-2.5 py-1 font-mono text-sm font-bold tabular-nums shadow-sm",
          s.accent === "primary" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground",
        )}>
          {fmtMultiplier(legs)}
        </span>
        <div className="absolute bottom-2 left-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-background/80 backdrop-blur">
            <Icon className={cn("h-4 w-4", s.accent === "primary" ? "text-primary" : "text-accent")} />
          </span>
          <h3 className="text-sm font-bold drop-shadow">{s.title}</h3>
        </div>
      </div>

      {/* legs */}
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs text-muted-foreground">{s.blurb}</p>
        <ul className="mt-3 space-y-1.5">
          {s.legs.map((l, idx) => (
            <li key={l.market.id} className="flex items-center gap-2 text-sm">
              <span className="truncate">{l.label}</span>
              <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-primary">
                {Math.round(probs[idx] * 100)}%
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={addAll}
          className={cn(
            "mt-4 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            allAdded
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border bg-secondary/40 hover:bg-secondary",
          )}
        >
          {allAdded ? <><Check className="h-4 w-4" /> Added to basket</> : <><Plus className="h-4 w-4" /> Add all legs</>}
        </button>
      </div>
    </article>
  );
}

function shortQ(q: string) {
  return q.replace(/^Will\s+/i, "").replace(/\s+at the 2026 FIFA World Cup\??$/i, "").replace(/\s+the 2026 FIFA World Cup\??$/i, "");
}
