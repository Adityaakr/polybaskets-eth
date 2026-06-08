import { useQuery } from "@tanstack/react-query";
import { buildBasketSeries, type ChartSeries } from "@/lib/priceHistory";

export interface SeriesLeg { slug: string; outcome: "Yes" | "No"; weightBps: number }

/** Shared live basket price-history query — same key dedupes between the chart and the position panel. */
export function useBasketSeries(legs: SeriesLeg[]) {
  const key = legs.map((l) => `${l.slug}:${l.outcome}:${l.weightBps}`).join("|");
  return useQuery<ChartSeries>({
    queryKey: ["basket-history", key],
    enabled: legs.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: () => buildBasketSeries(legs),
  });
}
