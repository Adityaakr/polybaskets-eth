# Brand — PolyBaskets (Vara.eth)

_Status: active_

Established palette (source of truth = `src/index.css` `:root`). Dark "terminal" theme with neon-green
primary and amber accent. Do not re-pick colors — reuse these tokens.

## Palette (HSL CSS variables)
| Token | HSL | Use |
|-------|-----|-----|
| `--background` | `220 25% 8%` | app base (deep navy-charcoal) |
| `--card` | `220 20% 12%` | card surfaces |
| `--primary` | `120 100% 50%` | **neon green** — primary actions, YES, gains, multipliers |
| `--accent` | `35 100% 55%` | **amber** — highlights, weights, badges |
| `--success` | `120 100% 45%` | profit/win |
| `--warning` | `45 100% 55%` | pending / challenge window |
| `--destructive` | `0 85% 60%` | NO, loss, errors |
| `--border`/`--input` | `220 15% 20%` | hairlines, fields |
| `--muted-foreground` | `0 0% 65%` | secondary text |
| `--radius` | `0.5rem` | base radius |

Shadows: `--shadow-soft/card/elevated`, neon glows `--shadow-primary` (green), `--shadow-accent` (amber).

## Typography
- UI: **Manrope** (300–800). Numbers/odds/addresses: **Source Code Pro** (tabular, mono). Both already
  loaded in `index.css`.

## Design direction (refs: Totalis parlay builder, Opinion markets)
Polished, dense, classy prediction-market layout:
- **Right-rail slip** ("Your Basket") — persistent betslip with legs, est. multiplier, payout, stake +
  quick-amount chips, primary CTA. (Replaces the bottom tray.)
- **Suggested baskets** — image-backed feature cards with a neon multiplier badge + "Add all legs".
- **Market grid** — cards with candidate rows and YES/NO pills (green/red), volume footers.
- **Category tab bar**, refined top nav with logo + balance.
- Restraint: neon green as an *accent of action* (text, rings, pills, multipliers), not big fills.

## Voice
Confident, concise, sportsbook-flavored. "Build your slip", "Place slip", "Add all legs",
"locks leg by leg", "paid from the house pool". Numbers always tabular.
