// Real Polymarket price history for basket legs (CLOB prices-history), combined into a chart series.
// Relative paths in both dev and prod — proxied by Vite (dev) or server.mjs (Railway).
// The CLOB API sends no CORS headers, so it MUST go through our proxy, never direct.
const gammaBase = "/gamma";
const clobBase = "/clob";

const asArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return []; } }
  return [];
};

/** Resolve a leg's CLOB token id for its selected outcome (Yes = index 0, No = index 1). */
export async function legTokenId(slug: string, outcome: "Yes" | "No"): Promise<string | null> {
  try {
    const r = await fetch(`${gammaBase}/markets?slug=${encodeURIComponent(slug)}`);
    const m = (await r.json())?.[0];
    const tokens = asArray(m?.clobTokenIds);
    if (!tokens.length) return null;
    return outcome === "Yes" ? tokens[0] : tokens[1] ?? null;
  } catch {
    return null;
  }
}

export interface PricePoint { t: number; p: number; } // t = ms, p = 0..1

/** Price history for a CLOB token. `interval=max` for full range, fidelity = minutes/point. */
export async function priceHistory(tokenId: string): Promise<PricePoint[]> {
  try {
    const r = await fetch(`${clobBase}/prices-history?market=${tokenId}&interval=max&fidelity=720`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d?.history ?? []).map((h: any) => ({ t: Number(h.t) * 1000, p: Number(h.p) }));
  } catch {
    return [];
  }
}

/**
 * Short human label from a market slug — just the team/entity, not the whole question:
 *   "will-croatia-win-the-2026-fifa-world-cup-986"            → "Croatia"
 *   "will-saudi-arabia-advance-to-the-knockout-stages-..."    → "Saudi Arabia"
 *   "will-norway-advance-to-..."                              → "Norway"
 */
export function labelFromSlug(slug: string): string {
  if (!slug) return "—";
  const cleaned = slug.replace(/^will-/, "").replace(/-\d+$/, "");
  // entity = everything before the first action verb / connector
  const stop = /-(win|advance|qualify|reach|make|be|finish|top|score|get|win-the|to|the)(-|$)/;
  const idx = cleaned.search(stop);
  let raw = idx > 0 ? cleaned.slice(0, idx) : cleaned;
  raw = raw.split("-").slice(0, 3).join("-"); // cap at 3 words as a fallback
  return raw
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "—";
}

export interface ChartLeg {
  slug: string;
  outcome: "Yes" | "No";
  weightBps: number;
  label: string;
  color: string;
}

export interface ChartSeries {
  /** [{ t, "0": pct, "1": pct, …, basket: pct }] — pct in 0..100 */
  points: Array<Record<string, number>>;
  legs: ChartLeg[];
  /** current value per leg index + the combined basket, in 0..100 */
  current: { byLeg: number[]; basket: number };
}

/** Distinct line colors (flag-ish, high-contrast on dark). */
export const LEG_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];

/**
 * Fetch all legs' real histories and combine into one time series + the weighted basket index.
 * Forward-fills each leg across the union of timestamps so lines are continuous.
 */
export async function buildBasketSeries(
  legs: Array<{ slug: string; outcome: "Yes" | "No"; weightBps: number }>,
): Promise<ChartSeries> {
  const chartLegs: ChartLeg[] = legs.map((l, i) => ({
    ...l,
    label: labelFromSlug(l.slug),
    color: LEG_COLORS[i % LEG_COLORS.length],
  }));

  const histories = await Promise.all(
    legs.map(async (l) => {
      const tok = await legTokenId(l.slug, l.outcome);
      return tok ? priceHistory(tok) : [];
    }),
  );

  // union of timestamps
  const tsSet = new Set<number>();
  histories.forEach((h) => h.forEach((pt) => tsSet.add(pt.t)));
  const timestamps = [...tsSet].sort((a, b) => a - b);

  // forward-fill each leg
  const cursors = histories.map(() => 0);
  const lastVal = histories.map(() => 0);
  const points: Array<Record<string, number>> = [];
  for (const t of timestamps) {
    const row: Record<string, number> = { t };
    let basket = 0;
    histories.forEach((h, i) => {
      while (cursors[i] < h.length && h[cursors[i]].t <= t) {
        lastVal[i] = h[cursors[i]].p;
        cursors[i]++;
      }
      const pct = lastVal[i] * 100;
      row[String(i)] = Number(pct.toFixed(2));
      basket += (legs[i].weightBps / 10000) * lastVal[i];
    });
    row.basket = Number((basket * 100).toFixed(2));
    points.push(row);
  }

  const last = points[points.length - 1] ?? {};
  return {
    points,
    legs: chartLegs,
    current: {
      byLeg: legs.map((_, i) => Number(last[String(i)] ?? 0)),
      basket: Number(last.basket ?? 0),
    },
  };
}
