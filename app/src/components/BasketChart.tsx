import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Loader2, TrendingUp } from "lucide-react";
import { useBasketSeries, type SeriesLeg as Leg } from "@/hooks/useBasketSeries";
import { cn } from "@/lib/utils";

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function ChartTooltip({ active, payload, label, series }: any) {
  if (!active || !payload?.length) return null;
  const basket = payload.find((p: any) => p.dataKey === "basket");
  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1 font-mono text-muted-foreground">
        {new Date(label).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
      </p>
      {series.legs.map((leg: any, i: number) => {
        const row = payload.find((p: any) => p.dataKey === String(i));
        if (!row) return null;
        return (
          <div key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: leg.color }} />
              {leg.label}
            </span>
            <span className="font-mono tabular-nums">{row.value}%</span>
          </div>
        );
      })}
      {basket && (
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border/60 pt-1 font-semibold text-primary">
          <span>Basket</span>
          <span className="font-mono tabular-nums">{basket.value}%</span>
        </div>
      )}
    </div>
  );
}

export default function BasketChart({ legs }: { legs: Leg[] }) {
  const { data, isLoading, isError } = useBasketSeries(legs);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border/60 bg-secondary/20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data || data.points.length < 2) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-xl border border-border/60 bg-secondary/20 text-center">
        <TrendingUp className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No price history available for these legs yet.</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
      {/* chart */}
      <div className="h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
            <XAxis
              dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
              tickFormatter={fmtDate} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))" minTickGap={48}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))" width={44} domain={[0, "auto"]}
            />
            <Tooltip content={(p) => <ChartTooltip {...p} series={data} />} />
            {data.legs.map((leg, i) => (
              <Line
                key={i} type="monotone" dataKey={String(i)} stroke={leg.color}
                strokeWidth={1.5} dot={false} strokeOpacity={0.65} isAnimationActive={false}
              />
            ))}
            {/* combined basket index — emphasized */}
            <Line
              type="monotone" dataKey="basket" stroke="hsl(var(--primary))"
              strokeWidth={2.5} dot={false} isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* live legend (like the example: label + current %) */}
      <div className="flex min-w-0 flex-col gap-2">
        {data.legs.map((leg, i) => (
          <LegendRow key={i} color={leg.color} label={leg.label} value={data.current.byLeg[i]} />
        ))}
        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5">
          <span className="truncate text-xs font-semibold text-primary">Basket</span>
          <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-primary">{data.current.basket.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs">{label}</span>
      </span>
      <span className={cn("shrink-0 font-mono text-xs font-medium tabular-nums")} style={{ color }}>
        {value.toFixed(1)}%
      </span>
    </div>
  );
}
