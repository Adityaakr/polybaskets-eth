import type { PolymarketMarket } from "@/types/polymarket";

/**
 * Gamma **events** client — follows Polymarket/agent-skills `market-data.md`:
 * "Events > Markets: events contain their markets, reducing API calls."
 *
 * The World Cup is one event (`world-cup-winner`, 60 country markets) plus many tagged events
 * (matches, group winners, reach-knockout). We fetch by slug or tag_id and flatten the markets
 * into our PolymarketMarket shape so the existing cards/odds helpers work unchanged.
 */

const GAMMA_BASE = (() => {
  const base = import.meta.env.VITE_GAMMA_PROXY || "https://gamma-api.polymarket.com";
  return base.includes("gamma-api") ? "/gamma" : base;
})();

interface GammaMarket {
  id?: string;
  conditionId?: string;
  question?: string;
  slug?: string;
  description?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
  volume?: number | string;
  liquidity?: number | string;
  image?: string;
  icon?: string;
  active?: boolean;
  closed?: boolean;
  endDate?: string;
  clobTokenIds?: string | string[];
  groupItemTitle?: string;
}

/** Derive a real YES/NO price array from outcomePrices → lastTradePrice → bid/ask. null if none. */
function realPrices(m: GammaMarket): string[] | undefined {
  const op = asArray(m.outcomePrices);
  if (op.length >= 2) {
    const y = parseFloat(op[0]), n = parseFloat(op[1]);
    if (Number.isFinite(y) && Number.isFinite(n) && y + n > 0) return op;
  }
  const ltp = Number(m.lastTradePrice);
  if (Number.isFinite(ltp) && ltp > 0 && ltp < 1) return [String(ltp), String(1 - ltp)];
  const bid = Number(m.bestBid), ask = Number(m.bestAsk);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
    const mid = (bid + ask) / 2;
    if (mid > 0 && mid < 1) return [String(mid), String(1 - mid)];
  }
  return undefined;
}

interface GammaEvent {
  id?: string;
  slug?: string;
  title?: string;
  image?: string;
  icon?: string;
  volume?: number;
  markets?: GammaMarket[];
  tags?: { id: number; label: string; slug: string }[];
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Map a Gamma event-market into our PolymarketMarket shape. */
export function mapGammaMarket(m: GammaMarket, ev?: GammaEvent): PolymarketMarket {
  const outcomes = asArray(m.outcomes);
  return {
    id: m.conditionId || m.id || m.slug || crypto.randomUUID(),
    slug: m.slug || ev?.slug || "",
    question: m.question || m.groupItemTitle || ev?.title || "",
    description: m.description,
    category: "Sports",
    active: m.active ?? true,
    closed: m.closed ?? false,
    outcomes: outcomes.length ? outcomes : ["Yes", "No"],
    outcomePrices: realPrices(m),
    volume: Number(m.volume) || 0,
    liquidity: Number(m.liquidity) || 0,
    endDate: m.endDate,
    image: m.image || m.icon || ev?.image || ev?.icon,
    icon: m.icon,
    clobTokenIds: asArray(m.clobTokenIds),
    markets: [],
    hasMore: false,
  } as PolymarketMarket;
}

async function gamma<T>(path: string): Promise<T> {
  const res = await fetch(`${GAMMA_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Gamma ${path} -> ${res.status}`);
  return res.json();
}

/** Fetch a single event by slug, with its markets mapped. */
export async function fetchEventBySlug(slug: string): Promise<{
  event: GammaEvent;
  markets: PolymarketMarket[];
} | null> {
  const events = await gamma<GammaEvent[]>(`/events?slug=${encodeURIComponent(slug)}`);
  const event = events?.[0];
  if (!event) return null;
  const markets = (event.markets ?? [])
    .filter((m) => !m.closed)
    .map((m) => mapGammaMarket(m, event));
  return { event, markets };
}

/** Fetch events by tag id, returning a flat list of mapped markets across those events. */
export async function fetchMarketsByEventTag(
  tagId: number,
  opts: { limit?: number; excludeSlugs?: string[] } = {},
): Promise<PolymarketMarket[]> {
  const limit = opts.limit ?? 20;
  const exclude = new Set(opts.excludeSlugs ?? []);
  const events = await gamma<GammaEvent[]>(
    `/events?tag_id=${tagId}&active=true&closed=false&order=volume&ascending=false&limit=${limit}`,
  );
  const out: PolymarketMarket[] = [];
  for (const ev of events ?? []) {
    if (ev.slug && exclude.has(ev.slug)) continue;
    for (const m of ev.markets ?? []) {
      if (!m.closed) out.push(mapGammaMarket(m, ev));
    }
  }
  return out;
}

/**
 * Realtime market search via Gamma's `/public-search` (the endpoint polymarket.com uses).
 * Returns mapped markets across the matched events, relevance-ordered, active only.
 */
export async function searchMarketsLive(query: string, limit = 50): Promise<PolymarketMarket[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await gamma<{ events?: GammaEvent[] }>(
    `/public-search?q=${encodeURIComponent(q)}&limit_per_type=30&events_status=active`,
  );
  const out: PolymarketMarket[] = [];
  const seen = new Set<string>();
  for (const ev of data.events ?? []) {
    for (const m of ev.markets ?? []) {
      if (m.closed) continue;
      const mapped = mapGammaMarket(m, ev);
      if (!seen.has(mapped.id)) {
        seen.add(mapped.id);
        out.push(mapped);
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Fetch the events list (titles + slugs + first market) by tag — for grouped browsing. */
export async function fetchEventsByTag(tagId: number, limit = 20): Promise<
  { slug: string; title: string; image?: string; volume: number; markets: PolymarketMarket[] }[]
> {
  const events = await gamma<GammaEvent[]>(
    `/events?tag_id=${tagId}&active=true&closed=false&order=volume&ascending=false&limit=${limit}`,
  );
  return (events ?? []).map((ev) => ({
    slug: ev.slug || "",
    title: (ev.title || "").trim(),
    image: ev.image || ev.icon,
    volume: Number(ev.volume) || 0,
    markets: (ev.markets ?? []).filter((m) => !m.closed).map((m) => mapGammaMarket(m, ev)),
  }));
}
