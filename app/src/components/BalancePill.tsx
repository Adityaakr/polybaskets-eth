import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { useLedger } from "@/contexts/LedgerContext";
import { useWallet } from "@/contexts/WalletContext";
import { fromBaseUnits } from "@/lib/varaeth/format";
import { usePrices, usdValue, fmtUsd } from "@/hooks/usePrices";

/** Compact deposited-balance pill in the nav (ETH + wVARA), links to the wallet page. */
export function BalancePill() {
  const ledger = useLedger();
  const wallet = useWallet();

  useEffect(() => {
    if (wallet.authenticated) ledger.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.authenticated, wallet.address]);

  const { data: prices } = usePrices();
  if (!wallet.authenticated) return null;

  const ethTok = Number(fromBaseUnits(ledger.balances.eth, "Eth", 18));
  const wvaraTok = Number(fromBaseUnits(ledger.balances.wvara, "Wvara", 18));
  const totalUsd = usdValue(ethTok, prices, "Eth") + usdValue(wvaraTok, prices, "Wvara");

  return (
    <Link
      to="/wallet"
      className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      title={`${fromBaseUnits(ledger.balances.eth, "Eth", 4)} ETH · ${fromBaseUnits(ledger.balances.wvara, "Wvara", 2)} wVARA`}
    >
      <Wallet className="h-4 w-4 text-primary" />
      <span className="font-mono font-semibold tabular-nums">{fmtUsd(totalUsd)}</span>
      <span className="text-border">·</span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {fromBaseUnits(ledger.balances.eth, "Eth", 3)} ETH · {fromBaseUnits(ledger.balances.wvara, "Wvara", 1)} wVARA
      </span>
    </Link>
  );
}
