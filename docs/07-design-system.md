# 07 — Design System (polished, card-based)

**Goal:** the Vara.eth site should feel unmistakably like PolyBaskets — same color language — but
**more polished**, **card-based**, and with **Polymarket-style expandable position detail**, while
keeping PolyBaskets' signature ability to **select multiple positions** into one basket.

## 1. Reuse the PolyBaskets palette (verbatim tokens)

Lift the existing CSS variables from the parent app's `src/index.css` `:root` block — do **not**
re-pick colors. The new app ships the same tokens so the two sites are visually siblings.

| Token | HSL (from live app) | Use |
|-------|--------------------|-----|
| `--background` | `220 25% 8%` | app base (deep navy-charcoal) |
| `--foreground` | `0 0% 98%` | primary text |
| `--card` | `220 20% 12%` | card surfaces |
| `--popover` | `220 20% 12%` | menus, drawers |
| `--primary` | `120 100% 50%` | **neon green** — primary actions, YES, gains |
| `--secondary` | `220 15% 15%` | secondary surfaces/buttons |
| `--muted` | `220 10% 18%` | muted fills |
| `--accent` | `35 100% 55%` | **amber** — highlights, weights, callouts |
| `--success` | `120 100% 45%` | profit / win |
| `--warning` | `45 100% 55%` | pending / challenge window |
| `--destructive` | `0 85% 60%` | NO, loss, errors |
| `--border` / `--input` | `220 15% 20%` | hairlines, fields |
| `--ring` | `120 100% 50%` | focus ring (green) |
| `--radius` | `0.5rem` | base radius |

Privy's modal `appearance` is themed to match: `theme: "dark"`, `accentColor: "hsl(120 100% 50%)"`.

### Polish layer (what "more polished" means here)
Same palette, elevated execution — guided by the `frontend-design-guidelines` and `page-load-animations` skills:

- **Depth via layered surfaces**, not heavy borders: `background` → `card` → elevated card using the
  existing `shadow-soft` / `shadow-card` / `shadow-elevated` tokens. Borders stay hairline
  (`border/0.75`).
- **Restrained neon**: green is an *accent of action*, not a fill. Big green surfaces look cheap;
  green on text, rings, sparklines, and the primary CTA looks premium.
- **Consistent rhythm**: 4/8px spacing scale, consistent card padding (e.g. `p-4`/`p-5`), one radius
  family.
- **Motion**: choreographed entrance (stagger cards in), 150–200ms hover/expand springs, animated
  number rolls for prices/P&L (reuse `number-formatting` rules). No "everything appears at once."
- **Typography hierarchy**: tabular-nums for all prices/odds/amounts; clear primary/secondary/muted
  tiers; market questions truncate to 2 lines with tooltip.

## 1.5 North-star direction: the **"Slip"** model (from the reference mockups)

The reference screenshots (sportsbook-style slip builder + Polymarket World Cup market) define the
visual and interaction target. A PolyBaskets basket is presented as a **slip**: a stack of *legs*,
each with odds, that compound into one multiplier and one estimated payout. This is the headline
metaphor for the whole app.

Reference patterns to implement (dark near-black surface, **neon-lime accent = our `--primary`**,
monospace/tabular numerals for all figures):

- **Slip builder card** ("New slip · World Cup 26 · 3 legs"): each leg is a row —
  `Team beats Team · date · price¢ · ×decimal-odds · [remove]`. An `+ Add leg` row. A **Stake**
  input. An **Estimated payout** block showing `$amount ×combined-multiplier` and the value line
  `≈ $X at a typical sportsbook · +Y% here`. Primary CTA `Place slip`. Footer microcopy
  `Estimated · locks leg by leg · cash out anytime`.
- **Leg selection** ("Add legs") with filter tabs (`Winners · Reach QF · Group winner`) and tactile
  green-check selection — this **is** our multi-select, themed as building a slip.
- **Live slip** ("My slip · 2 of 3 hit"): legs show Won/Pending state with rolled-forward amounts; a
  **Slip value now** figure with a **Cash out** button. Status pill `2 of 3 hit`.
- **Cash-out sheet**: `Rolled proceeds (N legs)`, `Pending leg — X cancels`, `You receive $amount`
  (neon), `Confirm cash out` / `Keep riding`, microcopy `True market value. No offer games.`
- **Polymarket-style market detail** (from the World Cup Winner screenshot): a **probability-over-time
  multi-line chart**, a **ranked candidate list** (e.g. Spain 16%, France 16%, England 11% …) each
  with Buy-YES / Buy-NO prices, volume, and a **related-markets** sidebar.

> Mapping to our chain model: "odds ×1.92" is a presentation of the Polymarket price (52¢ → 1/0.52 ≈
> 1.92); "combined multiplier" is the product across legs; "estimated payout" uses `betCalculator`.
> **Cash out** maps to selling/closing a position pre-settlement — a v2 capability (needs a
> secondary-market or buyback mechanism); for v1 we show settled claim payouts and mark cash-out as
> "coming soon" unless we add a buyback path (tracked in [12-open-questions.md](./12-open-questions.md)).

### Hero content: **World Cup 26**
The launch experience is curated around the **2026 FIFA World Cup**. The landing/Explore hero is a
World Cup module: tournament winner odds (ranked candidate list + probability chart), plus match
markets ("Team beats Team", "reach QF", "group winner") surfaced as ready-to-add legs. Data sourcing
for this is specified in [08-polymarket-reuse.md](./08-polymarket-reuse.md) (§ World Cup data).

## 2. Card-based information architecture

Everything is a card. Three core card types:

### a) Market card (Explore / Builder)
Compact, scannable, **selectable**. Selection is the heart of PolyBaskets — preserved and made
tactile.

```
┌─────────────────────────────────────────────┐
│ ◻ [img]  Will X happen by Jun 30?      ⓘ     │  ← checkbox = add to basket (multi-select)
│          Politics · Vol $1.2M                 │
│   ┌─────────────┐ ┌─────────────┐             │
│   │ YES  62¢ ▲  │ │  NO  38¢ ▼  │             │  ← pick outcome; selected ring in --primary
│   └─────────────┘ └─────────────┘             │
└─────────────────────────────────────────────┘
   selected → green ring + subtle green glow; lifts on hover (shadow-elevated)
```

### b) Position / holding card (Basket detail, MyBaskets) — **expandable, Polymarket-style**
Collapsed it's a tidy summary row-card; **click to expand** into rich detail (the behavior the user
called out from Polymarket), without leaving the page.

```
COLLAPSED                                   EXPANDED (click / chevron)
┌────────────────────────────────────┐     ┌────────────────────────────────────────────┐
│ Fed cuts rates  ·  YES   62¢   ▸    │     │ Fed cuts rates           YES   62¢   ▾       │
│ weight 25% · 0.012 ETH              │     │ weight 25% · staked 0.012 ETH                │
└────────────────────────────────────┘     │ ───────────────────────────────────────────  │
                                            │ 📈 price sparkline (entry → now)             │
                                            │ Entry idx 0.58 → Now 0.62   P&L +6.9% (green)│
                                            │ Shares 1,200 · Collateral ETH                │
                                            │ Resolution: Open · ends Jun 30               │
                                            │ Polymarket ↗   ·   tx ↗ (Hoodi explorer)     │
                                            └────────────────────────────────────────────┘
```

Implementation: Radix Accordion/Collapsible (already a dependency) with a height spring; lazy-load
the sparkline + on-chain enrichment (`usePositions`) only when expanded. P&L uses
`success`/`destructive`. Each leg of a basket is one expandable card; the basket header card
aggregates the weighted index and total P&L.

### c) Basket summary card
The hero card for a basket: name, weighted live index (big animated number), legs count, total
staked per collateral (ETH/wVARA chips), status pill (`Active` green / `SettlementPending` amber /
`Settled` muted), and the primary CTA (Bet / Claim).

## 3. Multi-select flow (preserved + upgraded)

PolyBaskets lets users assemble many outcomes into one basket — keep this central:

- **Selection tray** (sticky bottom bar / right rail): every selected market appears as a removable
  chip with its YES/NO and a weight input. Live readout of leg count, total weight (must = 100%),
  and the resulting **weighted index**.
- Multi-select works from Explore *and* within Builder; the tray persists across navigation via
  `BasketContext`.
- "Create basket" CTA in the tray → injected `CreateBasket`, then straight into the bet flow.
- Validation inline (reuse `basket-utils` rules: 1–N legs, weights sum to 100%, no dup outcome).

```
┌── selection tray (sticky) ───────────────────────────────────────────────┐
│ 3 legs · weight 100% ✓ · index 0.57   [Fed YES 25%×][BTC NO 40%×][…]  ▶ Build │
└──────────────────────────────────────────────────────────────────────────┘
```

## 4. The Wallet/Deposit surface (new, must feel first-class)

Because deposits are the one gas-paying moment, the Wallet page must be reassuring and clear:

- Two collateral cards: **ETH** and **wVARA**, each showing *Wallet balance* vs *Deposited (free)*
  vs *Locked in positions*.
- Deposit/Withdraw as clean modal flows with the explicit tx-state machine from
  [05-wallet-and-tx-flow.md](./05-wallet-and-tx-flow.md) (signing → pending → confirmed), amount
  input with max button, and a plain-language "this is an on-chain transaction (gas)" note —
  contrasted with the gasless betting elsewhere.

## 5. Component inventory (build/skin list)

| Component | Basis | Upgrade |
|-----------|-------|---------|
| `MarketCard` | parent market card | selectable, hover-lift, outcome pills |
| `SlipBuilder` | reference mockup 1/2 | legs + odds + multiplier + stake + estimated payout + value line |
| `SlipLegRow` | reference | `Team beats Team · date · ¢ · ×odds · remove` |
| `LegPicker` | reference mockup 2 | filter tabs + green-check multi-select |
| `LiveSlipCard` | reference mockup 3 | `N of M hit` pill, per-leg Won/Pending, slip-value-now |
| `CashOutSheet` | reference mockup 4 | rolled proceeds, you-receive, confirm/keep (v2-gated) |
| `MarketDetail` | reference mockup 5 (Polymarket) | probability-over-time chart + ranked candidates + related markets |
| `SelectionTray` | parent basket draft UI | sticky, weight inputs, live index/multiplier |
| `PositionCard` | new | collapsed↔expanded (Radix Collapsible), sparkline, P&L |
| `BasketSummaryCard` | new | animated index/multiplier, collateral chips, status pill |
| `WorldCupHero` | new | tournament winner odds + match-market legs (launch hero) |
| `DepositModal` / `WithdrawModal` | new | tx-state machine, per-collateral |
| `BalancePanel` | new | ETH + wVARA, wallet vs ledger vs locked |
| `TxStatePill` | new | disconnected→signing→pending→confirmed→failed |
| `NumberRoll` | `number-formatting` | tabular animated values |

> Reference mockups are described in §1.5 (the source screenshots were transient). Treat that section
> + the Polymarket World Cup layout as the visual spec; rebuild them in our tokens, more polished.

## 6. Guardrails

- Tokens only — no hard-coded hex; everything references the CSS variables so a future re-theme is
  one file.
- Dark theme is the default and only theme for v1 (matches the live app).
- Respect `prefers-reduced-motion` (gate the entrance/number-roll animations).
- Run the `frontend-design-guidelines` and `design-review` skills on the built pages before ship.

> The user noted "we will add more things here in design" — this doc is the **foundation**, not the
> ceiling. New surfaces should inherit these card/selection/expand patterns and the same tokens.
