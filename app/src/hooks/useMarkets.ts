import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketsByCategory, hasRealOdds } from "@/lib/polymarket";
import { searchMarketsLive } from "@/lib/gammaEvents";
import { getWorldCupCandidates, getWorldCupLegs, getWorldCupMatches } from "@/lib/worldCup";

/** Debounce a fast-changing value (e.g. a search box) so we don't hammer the API. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useMarketSearch(query: string, category?: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["markets", q, q ? "search" : category],
    queryFn: async () => {
      // realtime full-text search via Gamma /public-search; category browse otherwise.
      const markets = q
        ? await searchMarketsLive(q, 60)
        : await fetchMarketsByCategory((category || "sports") as any, 60);
      // real, tradeable odds only — drop markets with no live price (no mock 50/50)
      return markets.filter(hasRealOdds);
    },
    staleTime: q ? 5_000 : 30_000,
    placeholderData: (prev) => prev, // keep previous results visible while typing
  });
}

export function useWorldCupCandidates(limit = 12) {
  return useQuery({
    queryKey: ["worldcup", "candidates", limit],
    queryFn: () => getWorldCupCandidates(limit),
    staleTime: 60_000,
  });
}

export function useWorldCupLegs(limit = 24) {
  return useQuery({
    queryKey: ["worldcup", "legs", limit],
    queryFn: () => getWorldCupLegs(limit),
    staleTime: 60_000,
  });
}

export function useWorldCupMatches(limit = 12) {
  return useQuery({
    queryKey: ["worldcup", "matches", limit],
    queryFn: () => getWorldCupMatches(limit),
    staleTime: 60_000,
  });
}
