import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/contexts/WalletContext";
import { LedgerProvider } from "@/contexts/LedgerContext";
import { BasketProvider } from "@/contexts/BasketContext";
import { Layout } from "@/components/Layout";
import LandingPage from "@/pages/LandingPage";
import ExplorePage from "@/pages/ExplorePage";
import BuilderPage from "@/pages/BuilderPage";
import WalletPage from "@/pages/WalletPage";
import MyBasketsPage from "@/pages/MyBasketsPage";
import BasketPage from "@/pages/BasketPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <LedgerProvider>
          <BasketProvider>
            <TooltipProvider delayDuration={120}>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route element={<Layout />}>
                    <Route path="/explore" element={<ExplorePage />} />
                    <Route path="/build" element={<BuilderPage />} />
                    <Route path="/wallet" element={<WalletPage />} />
                    <Route path="/baskets" element={<MyBasketsPage />} />
                    <Route path="/basket/:id" element={<BasketPage />} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
              <Toaster position="top-right" richColors />
            </TooltipProvider>
          </BasketProvider>
        </LedgerProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}
