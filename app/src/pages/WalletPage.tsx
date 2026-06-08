import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Copy, Loader2, Mail, QrCode, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLedger } from "@/contexts/LedgerContext";
import { useWallet } from "@/contexts/WalletContext";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { usePrices, usdValue, fmtUsd } from "@/hooks/usePrices";
import { COLLATERALS, type Collateral } from "@/config";
import { fromBaseUnits } from "@/lib/varaeth/format";
import { truncateAddress } from "@/lib/basket-utils";
import { cn } from "@/lib/utils";

export default function WalletPage() {
  const ledger = useLedger();
  const wallet = useWallet();
  const { data: walletBal } = useWalletBalances(wallet.address);
  const { data: prices } = usePrices();

  useEffect(() => {
    if (wallet.authenticated) ledger.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.authenticated, wallet.address]);

  if (!wallet.authenticated) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-16 text-center">
        <Wallet className="h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-lg font-semibold">Sign in to manage your wallet</p>
        <Button className="mt-5" onClick={wallet.login} disabled={!wallet.enabled}>Sign in</Button>
      </div>
    );
  }

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Wallet header */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/60 p-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary">
            {wallet.isEmbedded ? <Mail className="h-5 w-5 text-primary" /> : <Wallet className="h-5 w-5 text-primary" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{wallet.isEmbedded ? "Email wallet" : "Connected wallet"}</p>
            <button
              onClick={() => wallet.address && copy(wallet.address, "Address")}
              className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {wallet.address ? truncateAddress(wallet.address) : "—"} <Copy className="h-3 w-3" />
            </button>
          </div>
          <span className="ml-auto rounded-full bg-secondary px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            Hoodi · Vara.eth
          </span>
        </div>
        {/* on-chain wallet balances */}
        <div className="grid grid-cols-2 divide-x divide-border/60">
          {COLLATERALS.map((c) => {
            const raw = c.key === "Eth" ? walletBal?.eth ?? 0n : walletBal?.wvara ?? 0n;
            const tok = Number(fromBaseUnits(raw, c.key, 18));
            return (
              <div key={c.key} className="p-5">
                <p className="text-xs text-muted-foreground">Wallet balance</p>
                <p className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                  {fromBaseUnits(raw, c.key)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">{c.symbol}</span>
                </p>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">{fmtUsd(usdValue(tok, prices, c.key))}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fund (receive) — essential for empty email wallets */}
      <FundCard address={wallet.address!} emphasize={wallet.isEmbedded} onCopy={copy} />

      {/* Deposit / withdraw per collateral */}
      <div>
        <h2 className="mb-3 text-lg font-bold">Deposit to play</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Move funds from your wallet into PolyBaskets to bet. Betting itself is gasless.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {COLLATERALS.map((c) => (
            <CollateralCard
              key={c.key}
              collateral={c.key}
              deposited={c.key === "Eth" ? ledger.balances.eth : ledger.balances.wvara}
              walletBalance={c.key === "Eth" ? walletBal?.eth ?? 0n : walletBal?.wvara ?? 0n}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FundCard({ address, emphasize, onCopy }: { address: string; emphasize: boolean; onCopy: (t: string, l: string) => void }) {
  const [open, setOpen] = useState(emphasize);
  return (
    <div className={cn("rounded-2xl border bg-card", emphasize ? "border-primary/40" : "border-border")}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary">
          <QrCode className="h-5 w-5 text-primary" />
        </span>
        <div>
          <p className="text-sm font-semibold">Fund your wallet</p>
          <p className="text-xs text-muted-foreground">
            {emphasize ? "Your email wallet is empty — send ETH or wVARA on Hoodi to start." : "Receive ETH or wVARA on Hoodi."}
          </p>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="flex flex-col items-center gap-4 border-t border-border/60 p-6 sm:flex-row sm:items-start">
          <div className="rounded-xl bg-white p-3">
            <QRCode value={address} size={148} bgColor="#ffffff" fgColor="#0a0e14" />
          </div>
          <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
            <div>
              <p className="text-xs text-muted-foreground">Your deposit address (Hoodi · chain 560048)</p>
              <p className="mt-1 break-all font-mono text-sm">{address}</p>
            </div>
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => onCopy(address, "Address")}>
              <Copy className="h-4 w-4" /> Copy address
            </Button>
            <p className="text-xs text-muted-foreground">
              Send only <span className="font-medium text-foreground">Hoodi ETH</span> or{" "}
              <span className="font-medium text-foreground">wVARA</span> to this address. Funds appear here, then
              deposit them below to bet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CollateralCard({ collateral, deposited, walletBalance }: { collateral: Collateral; deposited: bigint; walletBalance: bigint }) {
  const ledger = useLedger();
  const { data: prices } = usePrices();
  const meta = COLLATERALS.find((c) => c.key === collateral)!;
  const depositedUsd = usdValue(Number(fromBaseUnits(deposited, collateral, 18)), prices, collateral);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const injected = collateral === "Wvara";

  const submit = async () => {
    if (!amount) return;
    if (mode === "deposit") await ledger.deposit(collateral, amount);
    else await ledger.withdraw(collateral, amount);
    setAmount("");
  };
  const max = () => setAmount(fromBaseUnits(mode === "deposit" ? walletBalance : deposited, collateral, meta.decimals));

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{meta.symbol}</span>
        {injected ? (
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            <Zap className="h-3 w-3" /> injected
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{meta.decimals} dec</span>
        )}
      </div>

      {(() => {
        const pendingRaw = collateral === "Eth" ? ledger.pending.eth : ledger.pending.wvara;
        const syncing = pendingRaw > 0n;
        return (
          <>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              Deposited · available to bet
              {syncing && (
                <span className="flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> finalizing {fromBaseUnits(pendingRaw, collateral)}
                </span>
              )}
            </p>
            <p className="font-mono text-2xl font-bold tabular-nums">
              {fromBaseUnits(deposited, collateral)} <span className="text-sm font-normal text-muted-foreground">{meta.symbol}</span>
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">{fmtUsd(depositedUsd)}</p>
          </>
        );
      })()}

      <div className="mt-4 flex rounded-lg border border-border p-0.5">
        {(["deposit", "withdraw"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setAmount(""); }}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === m ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            inputMode="decimal"
            aria-label={`${mode} amount`}
            className="pr-12 font-mono tabular-nums"
          />
          <button
            onClick={max}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded font-mono text-[11px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            MAX
          </button>
        </div>
        <Button onClick={submit} disabled={ledger.busy || !amount} className="shrink-0 gap-1 capitalize">
          {mode === "deposit" ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
          {mode}
        </Button>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {mode === "deposit"
          ? injected ? "approve + injected pre-confirmation" : "on-chain transaction · gas applies"
          : "withdraw to your wallet"}
      </p>
    </div>
  );
}
