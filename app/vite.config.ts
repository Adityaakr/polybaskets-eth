import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8081,
    proxy: {
      // Polymarket Gamma API proxy (same as parent app) to avoid CORS in dev
      "/gamma": {
        target: "https://gamma-api.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gamma/, ""),
      },
      // Polymarket CLOB API proxy (price history) — no CORS headers, must proxy
      "/clob": {
        target: "https://clob.polymarket.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/clob/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  define: {
    global: "globalThis",
  },
}));
