import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { useBasketDraft } from "@/contexts/BasketContext";
import { useLedger } from "@/contexts/LedgerContext";
import { useWallet } from "@/contexts/WalletContext";
import { basketEntryIndex, basketMaxMultiplier, fmtMultiplier, fmtOdds, toCents } from "@/lib/odds";
import { COLLATERALS, type Collateral } from "@/config";
import { cn } from "@/lib/utils";

export default function BuilderPage() {
  const draft = useBasketDraft();
  const ledger = useLedger();
  const wallet = useWallet();
  const navigate = useNavigate();

  const [stake, setStake] = useState("20");
  const [collateral, setCollateral] = useState<Collateral>("Eth");
  const [submitting, setSubmitting] = useState(false);

  const legs = useMemo(
    () => draft.items.map((i) => ({ prob: i.currentProb ?? 0.5, weightBps: i.weightBps })),
    [draft.items],
  );
  const maxMult = useMemo(() => basketMaxMultiplier(legs), [legs]);
  const stakeNum = Number(stake) || 0;
  const maxPayout = stakeNum * maxMult;

  const canPlace =
    draft.items.length > 0 && draft.weightsValid && draft.name.trim().length > 0 && stakeNum > 0;

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
      const id = await ledger.createBasket(draft.name, draft.description, items);
      if (id != null) {
        const idxBps = Math.max(1, Math.min(10000, Math.round(basketEntryIndex(legs) * 10000)));
        await ledger.placeBet(id, collateral, stake, idxBps);
        draft.clear();
        navigate(`/basket/${id}`);
      }
    } catch {
      /* toast already shown */
    } finally {
      setSubmitting(false);
    }
  }

  if (draft.items.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-lg font-semibold">Your slip is empty</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Head to Explore and tap outcomes to add legs.
        </p>
        <Button className="mt-5" onClick={() => navigate("/explore")}>
          <Plus className="mr-1 h-4 w-4" /> Add legs
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_360px]">
      {/* Legs */}
      <div className="space-y-4">
        <div>
          <Input
            value={draft.name}
            onChange={(e) => draft.setName(e.target.value)}
            placeholder="Name your slip (e.g. World Cup 26 favourites)"
            className="text-base font-semibold"
            maxLength={48}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-semibold">{draft.items.length} legs</p>
            <button
              onClick={draft.evenWeights}
              className="font-mono text-xs text-primary hover:underline"
            >
              even weights
            </button>
          </div>
          <Separator />
          <ul className="divide-y divide-border/60">
            {draft.items.map((i) => (
              <li key={i.marketId} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{i.question}</span>
                  <span
                    className={cn(
                      "font-bold text-xs",
                      i.outcome === "YES" ? "text-primary" : "text-destructive",
                    )}
                  >
                    {i.outcome}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {toCents(i.currentProb ?? 0.5)}
                  </span>
                  <span className="font-mono text-xs tabular-nums opacity-70">
                    {fmtOdds(i.currentProb ?? 0.5)}
                  </span>
                  <button
                    onClick={() => draft.removeLeg(i.marketId)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <Slider
                    value={[i.weightBps]}
                    min={0}
                    max={10000}
                    step={100}
                    onValueChange={([v]) => draft.setWeight(i.marketId, v)}
                    className="flex-1"
                  />
                  <span className="w-12 text-right font-mono text-xs tabular-nums text-accent">
                    {Math.round(i.weightBps / 100)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Slip ticket */}
      <aside className="h-fit space-y-4 rounded-2xl border border-primary/30 bg-card p-5 lg:sticky lg:top-20">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">New slip</p>
          <span
            className={cn(
              "font-mono text-xs",
              draft.weightsValid ? "text-success" : "text-warning",
            )}
          >
            weight {Math.round(draft.totalWeightBps / 100)}% {draft.weightsValid ? "✓" : "(=100%)"}
          </span>
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Collateral</label>
          <div className="grid grid-cols-2 gap-2">
            {COLLATERALS.map((c) => (
              <button
                key={c.key}
                onClick={() => setCollateral(c.key)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                  collateral === c.key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/40 hover:bg-secondary",
                )}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Stake</label>
          <Input
            value={stake}
            onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="font-mono text-lg tabular-nums"
          />
        </div>

        <div className="rounded-xl bg-secondary/50 p-4">
          <p className="text-xs text-muted-foreground">Max payout · if all legs hit</p>
          <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">
            ${maxPayout.toFixed(2)}
            <span className="ml-2 text-sm font-normal text-primary">{fmtMultiplier(legs)}</span>
          </p>
          <p className="mt-1 text-xs text-success">scaled by how many legs resolve · paid from the house pool</p>
        </div>

        <Button className="w-full" size="lg" disabled={!canPlace || submitting} onClick={placeSlip}>
          {!wallet.authenticated
            ? "Sign in to place"
            : submitting
              ? "Placing…"
              : "Place slip"}
        </Button>
        {!ledger.chainReady && (
          <p className="text-center font-mono text-[11px] text-warning">
            chain not configured — set program + router env
          </p>
        )}
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          gasless · locks leg by leg · settles on vara.eth
        </p>
      </aside>
    </div>
  );
}
