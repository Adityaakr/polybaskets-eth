import { createContext, useContext, useMemo, useState, useCallback } from "react";
import type { BasketItem, Outcome } from "@/types/basket";
import type { PolymarketMarket } from "@/types/polymarket";
import { getOutcomeProbabilities } from "@/lib/polymarket";
import { normalizeWeights } from "@/lib/basket-utils";

interface BasketState {
  items: BasketItem[];
  name: string;
  description: string;
  setName: (s: string) => void;
  setDescription: (s: string) => void;
  /** toggle a market+outcome into/out of the slip */
  toggleLeg: (market: PolymarketMarket, outcome: Outcome) => void;
  isSelected: (marketId: string, outcome?: Outcome) => boolean;
  removeLeg: (marketId: string) => void;
  setWeight: (marketId: string, weightBps: number) => void;
  evenWeights: () => void;
  clear: () => void;
  totalWeightBps: number;
  weightsValid: boolean;
}

const Ctx = createContext<BasketState | null>(null);

export const useBasketDraft = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBasketDraft must be used within <BasketProvider>");
  return c;
};

export function BasketProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const toggleLeg = useCallback((market: PolymarketMarket, outcome: Outcome) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.marketId === market.id);
      if (existing) {
        // same outcome -> remove; different outcome -> switch
        if (existing.outcome === outcome) return prev.filter((i) => i.marketId !== market.id);
        return prev.map((i) => (i.marketId === market.id ? { ...i, outcome } : i));
      }
      const probs = getOutcomeProbabilities(market);
      const next: BasketItem = {
        marketId: market.id,
        slug: market.slug,
        question: market.question,
        outcome,
        weightBps: 0,
        currentProb: outcome === "YES" ? probs.YES : probs.NO,
      };
      return evenly([...prev, next]);
    });
  }, []);

  const isSelected = useCallback(
    (marketId: string, outcome?: Outcome) =>
      items.some((i) => i.marketId === marketId && (!outcome || i.outcome === outcome)),
    [items],
  );

  const removeLeg = useCallback(
    (marketId: string) => setItems((prev) => evenly(prev.filter((i) => i.marketId !== marketId))),
    [],
  );

  const setWeight = useCallback(
    (marketId: string, weightBps: number) =>
      setItems((prev) => prev.map((i) => (i.marketId === marketId ? { ...i, weightBps } : i))),
    [],
  );

  const evenWeights = useCallback(() => setItems((prev) => evenly(prev)), []);
  const clear = useCallback(() => {
    setItems([]);
    setName("");
    setDescription("");
  }, []);

  const totalWeightBps = items.reduce((s, i) => s + i.weightBps, 0);
  const weightsValid = items.length > 0 && totalWeightBps === 10000;

  const value = useMemo<BasketState>(
    () => ({
      items,
      name,
      description,
      setName,
      setDescription,
      toggleLeg,
      isSelected,
      removeLeg,
      setWeight,
      evenWeights,
      clear,
      totalWeightBps,
      weightsValid,
    }),
    [items, name, description, toggleLeg, isSelected, removeLeg, setWeight, evenWeights, clear, totalWeightBps, weightsValid],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** distribute weights evenly to sum 10000 bps (uses basket-utils normalizer). */
function evenly(items: BasketItem[]): BasketItem[] {
  if (items.length === 0) return items;
  const seeded = items.map((i) => ({ ...i, weightBps: Math.floor(10000 / items.length) }));
  return normalizeWeights(seeded);
}
