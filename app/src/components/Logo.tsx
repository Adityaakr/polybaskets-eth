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
        <span className="relative leading-none">
          <span className="text-xl">
            Poly<span className="text-primary">Baskets</span>
          </span>
          <span className="absolute -bottom-3 right-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Vara.eth
          </span>
        </span>
      )}
    </span>
  );
}
