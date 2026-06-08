import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketCard } from "@/components/MarketCard";
import { SuggestedBaskets } from "@/components/SuggestedBaskets";
import { WorldCupMatches } from "@/components/WorldCupMatches";
import { FeaturedWorldCup } from "@/components/FeaturedWorldCup";
import { BasketRail } from "@/components/BasketRail";
import { useMarketSearch, useDebounced } from "@/hooks/useMarkets";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { key: "sports", label: "Sports" },
];

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("sports");
  const debouncedQuery = useDebounced(query, 300);
  const { data: markets, isLoading, isFetching, isError, refetch } = useMarketSearch(debouncedQuery, category);
  const searching = query.trim().length > 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* main column */}
      <div className="space-y-8">
        {/* search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search markets — teams, events, questions…"
            aria-label="Search markets"
            className="h-11 rounded-xl pl-10 pr-16"
          />
          {searching && isFetching && (
            <Loader2 className="absolute right-9 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
          )}
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Featured: World Cup Winner card + cup banner */}
        {!query && (
          <>
            <FeaturedWorldCup />

            <section className="space-y-3">
              <SectionHeading eyebrow="Curated" title="Suggested baskets" />
              <SuggestedBaskets />
            </section>
          </>
        )}

        {/* category tabs + market grid */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <SectionHeading
              eyebrow={searching ? "Search" : "Live"}
              title={searching ? `Results${markets ? ` · ${markets.length}` : ""}` : "Markets"}
            />
            {!searching && CATEGORIES.length > 1 && (
              <div className="ml-auto flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      category === c.key
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* World Cup matches live inside the Sports section */}
          {!query && category === "sports" && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="font-mono text-[11px] uppercase tracking-widest text-primary">World Cup 26</span>
                <span className="text-muted-foreground">· Matches</span>
              </p>
              <WorldCupMatches />
            </div>
          )}

          {!query && category === "sports" && (
            <p className="pt-2 text-sm font-semibold text-muted-foreground">More sports</p>
          )}

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          ) : isError ? (
            <EmptyState title="Couldn't load markets" action="Retry" onAction={() => refetch()} />
          ) : markets && markets.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {markets.map((m) => <MarketCard key={m.id} market={m} />)}
            </div>
          ) : (
            <EmptyState title="No markets found" subtitle="Try another search term or category." />
          )}
        </section>
      </div>

      {/* right rail (desktop) */}
      <div className="hidden lg:block">
        <div className="sticky top-[5.5rem]">
          <BasketRail />
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">{eyebrow}</p>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
    </div>
  );
}

function EmptyState({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
      <p className="font-medium">{title}</p>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      {action && (
        <button onClick={onAction} className="mt-4 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {action}
        </button>
      )}
    </div>
  );
}
