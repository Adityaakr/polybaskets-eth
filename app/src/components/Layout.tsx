import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Wallet, LayoutGrid, Hammer, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@/components/ConnectButton";
import { SlipTray } from "@/components/SlipTray";
import { Logo } from "@/components/Logo";
import { BalancePill } from "@/components/BalancePill";

const NAV = [
  { to: "/explore", label: "Explore", icon: LayoutGrid },
  { to: "/build", label: "Build", icon: Hammer },
  { to: "/baskets", label: "My Baskets", icon: Layers },
  { to: "/wallet", label: "Wallet", icon: Wallet },
];

export function Layout() {
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <Link to="/">
            <Logo />
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <BalancePill />
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 lg:pb-10">
        <Outlet key={loc.pathname} />
      </main>

      {/* bottom tray is the mobile slip; desktop Explore uses the right rail instead */}
      <div className="lg:hidden">
        <SlipTray />
      </div>
    </div>
  );
}
