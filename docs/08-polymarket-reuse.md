# 08 — Polymarket Data Reuse (+ World Cup focus)

The Polymarket data layer is **chain-agnostic** and ports over **100% unchanged**. It's the same
data both the live Vara app and the new Vara.eth app consume.

## What we copy (verbatim) from the parent repo

| File | Lines | Role | Edits |
|------|-------|------|-------|
| `src/lib/polymarket.ts` | ~1900 | Gamma API client: market search, categories/tags, prices, resolution | none — copy as-is |
| `src/lib/basket-utils.ts` | ~250 | weighted index, snapshot, weight normalization, validation | none |
| `src/lib/betCalculator.ts` | ~230 | USD↔collateral, allocation, suggested stake, payout | minor: add ETH alongside wVARA conversion |

> Copy, don't cross-import. The new app keeps its own copy under `polybaskets-eth/app/src/lib/` so it
> builds independently and the live app is never touched. If `polymarket.ts` improves later, port the
> diff deliberately.

## Key API surface we rely on (already implemented)

- `fetchMarkets(filters)` — live Gamma markets with rich filters (category, tagId, volume, dates…)
- `searchMarkets(query, filters, category)` — ranked search
- `fetchMarketsByCategory(category, limit)` — tag-id primary, query/keyword fallback
- `fetchTags()` — Polymarket taxonomy (id/label/slug)
- `getOutcomeProbabilities(market)` — `{ YES, NO }` used by the index + odds display
- Session cache (30s) to stay within rate limits

## Mapping Polymarket data → our UI primitives

| UI element (design doc) | Source |
|--------------------------|--------|
| Leg odds `×1.92` | `1 / outcomePrice` (e.g. 0.52 → 1.92) |
| Leg price `52¢` | `outcomePrice * 100` |
| Combined multiplier | product of per-leg odds (or index-derived) |
| Estimated payout | `betCalculator` (stake × multiplier, USD→collateral) |
| Candidate list (% odds) | multi-outcome market `outcomes[]` + `outcomePrices[]` |
| Probability-over-time chart | Polymarket price history endpoint (see below) |
| Resolution / "Won/Pending" | `closed` / resolution fields (drives settlement + live slip) |

## § World Cup data (the launch focus)

The hero experience curates the **2026 FIFA World Cup**. Polymarket has deep World Cup markets
(the reference shows a "World Cup Winner" market at ~$1.6B volume with Spain/France/England/Portugal
candidates, plus per-match and progression markets).

### Sourcing strategy
1. **Tournament-winner market** — a single multi-outcome market ("World Cup Winner"): one card with
   the ranked candidate list + probability-over-time chart (Polymarket-style detail view).
2. **Match & progression markets** — "Team beats Team", "reach quarter-finals", "group winner" —
   surfaced as **ready-to-add slip legs** in the `LegPicker` with filter tabs.
3. Fetch via the existing client:
   - `fetchMarketsByCategory('sports', ...)` then keyword-filter for World Cup / FIFA / team names, **or**
   - resolve the Soccer / "FIFA World Cup" **tag id** via `fetchTags()` and pass `tagId` to
     `fetchMarkets` for precise pulls (preferred — avoids keyword noise).
4. Add a small `worldCup.ts` curation helper in the new app (not a `polymarket.ts` edit) that:
   - pins the canonical World Cup Winner market id/slug,
   - groups match markets by matchday/group,
   - exposes `getWorldCupWinner()` and `getWorldCupLegs(filter)` for the hero + leg picker.

### Things to verify during the data spike
- The exact Polymarket **tag id** for the 2026 FIFA World Cup (resolve live via `fetchTags()`; do not
  hard-code blindly).
- The **price-history endpoint** for the probability-over-time chart (Polymarket exposes historical
  series per token/market; confirm the shape and add a typed fetcher).
- Market **liquidity/volume thresholds** so the hero only shows liquid, tradeable World Cup markets.
- Resolution timing & fields so the settler bot can settle World Cup baskets correctly
  ([09-settlement-and-bot.md](./09-settlement-and-bot.md)).

> World Cup is the *launch curation*, not a hard-coding of the product — the same components work for
> any Polymarket category. Curation lives in `worldCup.ts` config so we can re-point to other events
> later without touching the data client.
