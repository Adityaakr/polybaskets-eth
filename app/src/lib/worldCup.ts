import type { PolymarketMarket } from "@/types/polymarket";
import { getOutcomeProbabilities, hasRealOdds } from "@/lib/polymarket";
import { fetchEventBySlug, fetchMarketsByEventTag, fetchEventsByTag } from "@/lib/gammaEvents";
import { config } from "@/config";

/**
 * World Cup 26 curation (docs/08 § World Cup) — powered by the Gamma **events** API per
 * Polymarket/agent-skills. The winner hero comes from the `world-cup-winner` event (60 country
 * "Will X win?" markets); legs come from the `2026 FIFA World Cup` tag (matches, groups, knockout).
 */

const WINNER_SLUG = config.worldCup.winnerSlug || "world-cup-winner";
const WC_TAG = config.worldCup.tagId || 102350; // "2026 FIFA World Cup"

export interface WinnerCandidate {
  market: PolymarketMarket;
  name: string;
  prob: number;
}

/** Strip "Will <Name> win the 2026 FIFA World Cup?" -> "<Name>". */
function teamName(question: string): string {
  const m = question.match(/will\s+(.+?)\s+win/i);
  return (m?.[1] || question).trim();
}

/** Ranked winner candidates (each is an addable YES leg), highest probability first. */
export async function getWorldCupCandidates(limit = 12): Promise<WinnerCandidate[]> {
  const res = await fetchEventBySlug(WINNER_SLUG);
  if (!res) return [];
  return res.markets
    .filter(hasRealOdds)
    .map((market) => ({
      market,
      name: teamName(market.question),
      prob: getOutcomeProbabilities(market).YES,
    }))
    .filter((c) => c.prob > 0 && c.prob < 1)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, limit);
}

/** Match / progression markets across World Cup events — ready-to-add slip legs. */
export async function getWorldCupLegs(limit = 24): Promise<PolymarketMarket[]> {
  try {
    const markets = await fetchMarketsByEventTag(WC_TAG, {
      limit: 30,
      excludeSlugs: [WINNER_SLUG],
    });
    // real, tradeable two-sided prices only — no mock fallbacks
    return markets
      .filter(hasRealOdds)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Grouped event browsing (title + its markets) for richer World Cup sections. */
export async function getWorldCupEvents(limit = 12) {
  try {
    return await fetchEventsByTag(WC_TAG, limit);
  } catch {
    return [];
  }
}

const FIFA_TAG = 102232; // broader "FIFA World Cup" tag — carries the team-vs-team match events
const NON_MATCH = /H2H|Goals|Winner|Region|Continent|Golden|Player|Top Scorer|reach|advance|unbeaten|knockout|group/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface WorldCupMatch {
  title: string;
  image?: string;
  teamA: string;
  teamB: string;
  outcomes: { label: string; market: PolymarketMarket; prob: number }[];
}

/** Actual World Cup team matches (Mexico vs South Africa …) as 3-way YES legs. */
export async function getWorldCupMatches(limit = 12): Promise<WorldCupMatch[]> {
  try {
    const events = await fetchEventsByTag(FIFA_TAG, 60);
    return events
      .filter((e) => / vs\.? /i.test(e.title) && !NON_MATCH.test(e.title))
      .map((e) => {
        const [teamA = "", teamB = ""] = e.title.split(/\s+vs\.?\s+/i).map((s) => s.trim());
        const find = (re: RegExp) => e.markets.find((m) => re.test(m.question) && hasRealOdds(m));
        const winA = teamA && find(new RegExp(`will\\s+${escapeRe(teamA)}\\s+win`, "i"));
        const draw = find(/draw/i);
        const winB = teamB && find(new RegExp(`will\\s+${escapeRe(teamB)}\\s+win`, "i"));
        const outcomes = [
          winA && { label: teamA, market: winA, prob: getOutcomeProbabilities(winA).YES },
          draw && { label: "Draw", market: draw, prob: getOutcomeProbabilities(draw).YES },
          winB && { label: teamB, market: winB, prob: getOutcomeProbabilities(winB).YES },
        ].filter(Boolean) as WorldCupMatch["outcomes"];
        return { title: e.title, image: e.image, teamA, teamB, outcomes };
      })
      .filter((m) => m.outcomes.length >= 2)
      .slice(0, limit);
  } catch {
    return [];
  }
}
