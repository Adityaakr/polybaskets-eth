import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Ticket, ShoppingBasket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useBasketDraft } from "@/contexts/BasketContext";
import { useLedger } from "@/contexts/LedgerContext";
import { useWallet } from "@/contexts/WalletContext";
import { basketEntryIndex, basketMaxMultiplier, fmtMultiplier, fmtOdds, toCents } from "@/lib/odds";
import { usePrices, priceOf, usdToToken, usdValue, fmtToken, fmtUsd } from "@/hooks/usePrices";
import { fromBaseUnits } from "@/lib/varaeth/format";
import { COLLATERALS, type Collateral } from "@/config";

const QUICK = ["5", "10", "20", "50"];

/** Persistent right-rail slip — build legs, set stake, place the bet. */
export function BasketRail() {
  const draft = useBasketDraft();
  const ledger = useLedger();
  const wallet = useWallet();
  const navigate = useNavigate();
  const [stake, setStake] = useState("10");
  const [collateral, setCollateral] = useState<Collateral>("Eth");
  const [submitting, setSubmitting] = useState(false);

  const legs = useMemo(
    () => draft.items.map((i) => ({ prob: i.currentProb ?? 0.5, weightBps: i.weightBps })),
    [draft.items],
  );
  const maxMult = useMemo(() => basketMaxMultiplier(legs), [legs]);
  const { data: prices } = usePrices();
  const px = priceOf(prices, collateral);
  const sym = collateral === "Eth" ? "ETH" : "wVARA";
  const stakeNum = Number(stake) || 0; // USD
  const tokenAmount = usdToToken(stakeNum, prices, collateral); // collateral units to actually bet
  const maxPayout = stakeNum * maxMult; // USD
  // live deposited balance for the selected collateral
  const depositedRaw = collateral === "Eth" ? ledger.balances.eth : ledger.balances.wvara;
  const depositedTok = Number(fromBaseUnits(depositedRaw, collateral, 18));
  const enoughBalance = depositedTok >= tokenAmount && tokenAmount > 0;
  const canPlace =
    draft.items.length > 0 && draft.weightsValid && draft.name.trim().length > 0 &&
    stakeNum > 0 && px > 0 && enoughBalance;

  async function placeSlip() {
    if (!wallet.authenticated) return wallet.login();
    setSubmitting(true);
    try {
      const items = draft.items.map((i) => ({
        poly_market_id: i.marketId,
        poly_slug: i.slug,
        weight_bps: i.weightBps,
        selected_outcome: (i.outcome === "YES" ? "Yes" : "No") as "Yes" | "No",
      }));
      // index_at_creation_bps = the real weighted entry index (payout = settlement_index / this)
      const idxBps = Math.max(1, Math.min(10000, Math.round(basketEntryIndex(legs) * 10000)));
      // Create + bet in one pre-confirmed flow. Stay on this page — clearing the slip + a
      // success toast feels instant; the basket commits in the background (~30-60s).
      const id = await ledger.placeSlip(draft.name, draft.description, items, collateral, String(tokenAmount), idxBps, {
        onView: (bid) => navigate(`/basket/${bid}`),
      });
      if (id != null) draft.clear();
    } catch {
      /* toast shown */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Ticket className="h-4 w-4 text-primary" />
          Your Basket
        </span>
        {draft.items.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {draft.items.length} {draft.items.length === 1 ? "leg" : "legs"}
            </span>
            <button
              onClick={draft.clear}
              className="rounded text-[11px] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          </span>
        )}
      </header>

      {draft.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary/60">
            <ShoppingBasket className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="text-sm font-medium">Your basket is empty</p>
          <p className="text-xs text-muted-foreground">
            Tap outcomes in the markets to add legs and build a slip.
          </p>
        </div>
      ) : (
        <>
          {/* legs */}
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
            {draft.items.map((i) => (
              <div
                key={i.marketId}
                className="group flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/30 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs font-medium leading-snug">{i.question}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px]">
                    <span className={i.outcome === "YES" ? "font-bold text-primary" : "font-bold text-destructive"}>
                      {i.outcome}
                    </span>
                    <span className="text-muted-foreground">{toCents(i.currentProb ?? 0.5)}</span>
                    <span className="text-accent">· {Math.round(i.weightBps / 100)}%</span>
                    <span className="opacity-60">{fmtOdds(i.currentProb ?? 0.5)}</span>
                  </p>
                </div>
                <button
                  onClick={() => draft.removeLeg(i.marketId)}
                  aria-label={`Remove ${i.question}`}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* summary + stake + CTA */}
          <div className="space-y-3 border-t border-border/70 bg-background/40 p-4">
            <label className="block">
              <span className="sr-only">Basket name</span>
              <Input
                value={draft.name}
                onChange={(e) => draft.setName(e.target.value)}
                placeholder="Name your slip…"
                maxLength={48}
                className="h-9 text-sm"
              />
            </label>

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Weights</span>
              <span className={cn("font-mono", draft.weightsValid ? "text-success" : "text-warning")}>
                {Math.round(draft.totalWeightBps / 100)}%{" "}
                {draft.weightsValid ? "✓" : <button onClick={draft.evenWeights} className="underline">fix</button>}
              </span>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">Pay with</span>
              <div className="grid grid-cols-2 gap-1.5">
                {COLLATERALS.map((c) => {
                  const raw = c.key === "Eth" ? ledger.balances.eth : ledger.balances.wvara;
                  const tok = Number(fromBaseUnits(raw, c.key, 18));
                  return (
                    <button
                      key={c.key}
                      onClick={() => setCollateral(c.key)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        collateral === c.key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary/40 hover:bg-secondary",
                      )}
                    >
                      <span className="text-xs font-medium">{c.symbol}</span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {fmtToken(tok, c.key)} · {fmtUsd(usdValue(tok, prices, c.key))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Bet amount</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {px > 0 ? `1 ${sym} ≈ ${fmtUsd(px)}` : "loading price…"}
                </span>
              </div>

              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-muted-foreground">$</span>
                <Input
                  value={stake}
                  onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  aria-label="Bet amount in USD"
                  className="h-12 pl-8 font-mono text-lg tabular-nums"
                />
              </div>

              {/* you bet ↔ your balance — clean two-sided row */}
              <div className="flex items-center justify-between font-mono text-xs tabular-nums">
                <span>
                  ≈ <span className="font-medium text-primary">{fmtToken(tokenAmount, collateral)} {sym}</span>
                </span>
                <span className="text-muted-foreground">Bal {fmtToken(depositedTok, collateral)} {sym}</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    onClick={() => setStake(q)}
                    className={cn(
                      "rounded-lg border py-1.5 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      stake === q
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    ${q}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1 rounded-xl bg-secondary/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Max payout · if all legs hit</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                  {fmtMultiplier(legs)}
                </span>
              </div>
              <p className="font-mono text-3xl font-bold leading-none tabular-nums text-primary">{fmtUsd(maxPayout)}</p>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                ≈ {fmtToken(tokenAmount * maxMult, collateral)} {sym}
              </p>
            </div>

            <Button className="h-11 w-full text-sm font-semibold" disabled={!canPlace || submitting} onClick={placeSlip}>
              {submitting ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Placing…</>
              ) : !wallet.authenticated ? (
                "Sign in to place"
              ) : px <= 0 ? (
                "Loading price…"
              ) : stakeNum > 0 && !enoughBalance ? (
                `Not enough ${sym} — deposit first`
              ) : (
                "Place slip"
              )}
            </Button>
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              gasless · locks leg by leg · paid from the house pool
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
