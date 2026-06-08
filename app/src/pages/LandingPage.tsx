import { Link } from "react-router-dom";
import { ArrowRight, Zap, Mail, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/ConnectButton";
import { Logo } from "@/components/Logo";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex h-20 max-w-6xl items-center px-4">
        <Logo size={56} />
        <div className="ml-auto">
          <ConnectButton />
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pb-24 pt-6 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs uppercase tracking-widest text-primary">
          <Zap className="h-3.5 w-3.5" /> World Cup 26 · gasless betting on Vara.eth
        </span>

        {/* Hero banner */}
        <Link
          to="/explore"
          aria-label="Explore World Cup 26 markets"
          className="group relative mx-auto mt-6 block w-full max-w-4xl overflow-hidden rounded-2xl ring-1 ring-border transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* neon glow */}
          <div className="pointer-events-none absolute -inset-1 -z-10 rounded-[1.25rem] bg-gradient-to-r from-primary/30 via-accent/20 to-primary/30 opacity-60 blur-xl transition-opacity duration-300 group-hover:opacity-90" />
          <img
            src="/cup.png"
            alt="FIFA World Cup 26 — predict and win on PolyBaskets"
            width={1672}
            height={941}
            className="block h-auto w-full"
          />
        </Link>

        <h1 className="mx-auto mt-10 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
          Bundle predictions into one{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">slip</span>.
          Bet it on Ethereum.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Stack Polymarket outcomes into a weighted basket and bet the bundle as one position —
          settled on Vara.eth. Email login, deposit ETH or wVARA, gasless pre-confirmed bets.
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link to="/explore">
              Build your slip <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
          {[
            { icon: Mail, t: "Email login", d: "Privy embedded wallet — no extension, no seed phrase." },
            { icon: Zap, t: "Gasless bets", d: "Injected pre-confirmations on Vara.eth feel instant." },
            { icon: Layers, t: "Multi-leg slips", d: "Weight many outcomes into one tradeable basket." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-xl border border-border bg-card p-5">
              <Icon className="h-6 w-6 text-primary" aria-hidden />
              <p className="mt-3 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
