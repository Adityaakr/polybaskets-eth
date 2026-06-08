import { useQuery } from "@tanstack/react-query";
import type { Collateral } from "@/config";

export interface Prices {
  eth: number; // ETH/USD
  vara: number; // VARA/USD (== wVARA, wrapped 1:1)
}

/** Live USD prices for ETH + VARA from CoinGecko. Polls every 45s. */
export function usePrices() {
  return useQuery<Prices>({
    queryKey: ["prices"],
    refetchInterval: 45_000,
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,vara-network&vs_currencies=usd",
      );
      if (!r.ok) throw new Error(`coingecko ${r.status}`);
      const d = await r.json();
      return {
        eth: Number(d?.ethereum?.usd) || 0,
        vara: Number(d?.["vara-network"]?.usd) || 0,
      };
    },
  });
}

/** USD price for a collateral. */
export const priceOf = (prices: Prices | undefined, c: Collateral): number =>
  !prices ? 0 : c === "Eth" ? prices.eth : prices.vara;

/** USD value of a token amount (human units). */
export const usdValue = (amount: number, prices: Prices | undefined, c: Collateral): number =>
  amount * priceOf(prices, c);

/** Convert a USD amount into collateral units (human). 0 if no price yet. */
export const usdToToken = (usd: number, prices: Prices | undefined, c: Collateral): number => {
  const p = priceOf(prices, c);
  return p > 0 ? usd / p : 0;
};

/** "$1,052.64" */
/** "$1,052.64" — but sub-cent values (e.g. 1 wVARA ≈ $0.00057) keep precision instead of "$0.00". */
export const fmtUsd = (n: number): string => {
  if (!Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  const maxFrac = abs > 0 && abs < 1 ? (abs < 0.01 ? 6 : 4) : 2;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}`;
};

/** Trim a token amount for display (more dp for tiny ETH, fewer for big wVARA). */
export const fmtToken = (n: number, c: Collateral): string => {
  if (!Number.isFinite(n)) return "0";
  const dp = c === "Eth" ? 6 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
};
