import { cn } from "@/lib/utils";

/** PolyBaskets wordmark using the real logo asset (public/poly-1.png). */
export function Logo({
  className,
  size = 52,
  showWordmark = true,
}: {
  className?: string;
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-0 font-bold tracking-tight", className)}>
      <img
        src="/poly-1.png"
        alt="PolyBaskets"
        width={size}
        height={size}
        className="-mr-1.5 rounded-lg object-contain"
        style={{ width: size, height: size }}
      />
      {showWordmark && (
        <span className="text-xl">
          Poly<span className="text-primary">Baskets</span>
          <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            vara.eth
          </span>
        </span>
      )}
    </span>
  );
}
