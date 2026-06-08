import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Wallet, LayoutGrid, Hammer, Layers, Menu, X } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  // close the mobile menu on navigation
  useEffect(() => setMenuOpen(false), [loc.pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <Link to="/" aria-label="Home">
            <Logo />
          </Link>

          {/* desktop nav */}
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

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <BalancePill />
            <ConnectButton />
            {/* mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* mobile dropdown menu */}
        {menuOpen && (
          <nav className="border-t border-border/70 bg-background/95 px-4 py-2 backdrop-blur-xl md:hidden">
            <div className="mx-auto max-w-7xl">
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors",
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
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
