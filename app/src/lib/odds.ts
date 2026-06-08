/** Presentation + payout helpers (docs/03 — must match the on-chain payout model). */

/** 0.52 -> "52¢" */
export const toCents = (prob: number) => `${Math.round(clamp(prob) * 100)}¢`;

/** 0.52 -> 1.92 (decimal odds for a single leg) */
export const toDecimalOdds = (prob: number) => {
  const p = clamp(prob);
  return p <= 0 ? 0 : 1 / p;
};

/** "×1.92" — single-leg decimal odds */
export const fmtOdds = (prob: number) => `×${toDecimalOdds(prob).toFixed(2)}`;

/** 0.62 -> "62%" */
export const toPct = (prob: number) => `${Math.round(clamp(prob) * 100)}%`;

export interface WeightedLeg {
  prob: number; // 0..1 entry probability of the picked outcome
  weightBps: number; // 0..10000
}

/**
 * Weighted entry index — exactly what the contract stores as `index_at_creation_bps / 10000`.
 *   entryIndex = Σ (weightBps_i / 10000) · prob_i      (range 0..1)
 */
export function basketEntryIndex(legs: WeightedLeg[]): number {
  if (!legs.length) return 0;
  const totalW = legs.reduce((s, l) => s + l.weightBps, 0) || 10000;
  return legs.reduce((s, l) => s + (l.weightBps / totalW) * clamp(l.prob), 0);
}

/**
 * Maximum payout multiplier = what you get if EVERY leg resolves in your favour.
 * On-chain: payout = shares · settlement_index / entry_index; max settlement_index = 1.0 (10000 bps).
 *   maxMultiplier = 1 / entryIndex
 * This is the real ceiling — never the parlay product of odds.
 */
export function basketMaxMultiplier(legs: WeightedLeg[]): number {
  const idx = basketEntryIndex(legs);
  return idx > 0 ? 1 / idx : 1;
}

/** "×7.0" formatted max multiplier for a basket. */
export function fmtMultiplier(legs: WeightedLeg[]): string {
  const m = basketMaxMultiplier(legs);
  return `×${m >= 100 ? Math.round(m) : m.toFixed(2)}`;
}

function clamp(p: number) {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
}
