import type { OnchainPosition, OnchainSettlement, OnchainBasket } from "@/lib/varaeth";

/**
 * Value of a position. Uses the finalized settlement index when settled, otherwise the live
 * combined basket index (mark-to-market). All amounts in base units (bigint).
 *   value   = stake × index_bps / entry_bps
 *   payout  = stake × 10000   / entry_bps   (if every leg hits)
 */
export function positionMath(
  position: OnchainPosition,
  settlement: OnchainSettlement | null,
  liveBasketBps: number, // 0..10000 from the live chart; ignored once settled
) {
  const entryBps = position.index_at_creation_bps || 1;
  const stake = position.shares;
  const settled = !!settlement && settlement.status === "Finalized";
  const indexBps = settled ? settlement!.index_bps : Math.max(0, Math.min(10000, Math.round(liveBasketBps)));
  const value = (stake * BigInt(indexBps)) / BigInt(entryBps);
  const maxPayout = (stake * 10000n) / BigInt(entryBps);
  const pnl = value - stake; // signed
  return { entryBps, stake, value, maxPayout, pnl, indexBps, settled };
}

export type BasketStatus = OnchainBasket["status"];

export function isClaimable(basket: OnchainBasket, position: OnchainPosition | null, settlement: OnchainSettlement | null) {
  return basket.status === "Settled" && settlement?.status === "Finalized" && !!position && !position.claimed;
}
