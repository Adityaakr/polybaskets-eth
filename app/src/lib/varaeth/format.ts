import { formatUnits, parseUnits } from "viem";
import { type Collateral, collateralMeta } from "@/config";

/** Parse a human amount string into base units for a collateral (ETH 18 / wVARA 12). */
export function toBaseUnits(amount: string | number, c: Collateral): bigint {
  const { decimals } = collateralMeta(c);
  const s = typeof amount === "number" ? String(amount) : amount.trim();
  if (!s || Number.isNaN(Number(s))) return 0n;
  return parseUnits(s as `${number}`, decimals);
}

/** Format base units into a trimmed human string for a collateral. */
export function fromBaseUnits(amount: bigint, c: Collateral, maxFrac = 6): string {
  const { decimals } = collateralMeta(c);
  const full = formatUnits(amount, decimals);
  const [whole, frac = ""] = full.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** "1.2345 ETH" style display. */
export function displayAmount(amount: bigint, c: Collateral, maxFrac = 6): string {
  return `${fromBaseUnits(amount, c, maxFrac)} ${collateralMeta(c).symbol}`;
}
