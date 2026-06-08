import { useNavigate, useLocation } from "react-router-dom";
import { X, ChevronRight, Ticket } from "lucide-react";
import { useBasketDraft } from "@/contexts/BasketContext";
import { basketMaxMultiplier, fmtMultiplier } from "@/lib/odds";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function SlipTray() {
  const { items, removeLeg, totalWeightBps, weightsValid } = useBasketDraft();
  const navigate = useNavigate();
  const loc = useLocation();
  if (items.length === 0) return null;

  const legs = items.map((i) => ({ prob: i.currentProb ?? 0.5, weightBps: i.weightBps }));
  const onBuilder = loc.pathname === "/build";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Ticket className="h-4 w-4 text-primary" />
          <span className="font-semibold">{items.length} legs</span>
          <span
            className={cn(
              "font-mono text-xs",
              weightsValid ? "text-success" : "text-warning",
            )}
          >
            · {Math.round(totalWeightBps / 100)}% {weightsValid ? "✓" : ""}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            · {fmtMultiplier(legs)} max
          </span>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto md:flex">
          {items.map((i) => (
            <span
              key={i.marketId}
              className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-1 text-xs"
            >
              <span className="max-w-[160px] truncate">{i.question}</span>
              <span
                className={cn(
                  "font-bold",
                  i.outcome === "YES" ? "text-primary" : "text-destructive",
                )}
              >
                {i.outcome}
              </span>
              <button onClick={() => removeLeg(i.marketId)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <Button
          className="ml-auto gap-1 shrink-0"
          onClick={() => navigate("/build")}
          disabled={onBuilder}
        >
          {onBuilder ? "Building" : "Build slip"}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
