import { LogOut, Mail, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/basket-utils";

export function ConnectButton() {
  const wallet = useWallet();

  if (!wallet.enabled) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5" />
        Set VITE_PRIVY_APP_ID
      </div>
    );
  }

  if (!wallet.ready) {
    return <Button variant="secondary" size="sm" disabled>…</Button>;
  }

  if (!wallet.authenticated) {
    return (
      <Button size="sm" onClick={wallet.login} className="gap-1.5">
        <Mail className="h-4 w-4" />
        Sign in
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">
        {wallet.address ? truncateAddress(wallet.address) : "—"}
      </span>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={wallet.logout} title="Sign out">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
