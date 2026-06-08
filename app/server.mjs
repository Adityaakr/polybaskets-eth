// Production server for Railway — zero dependencies (Node built-ins only).
//   - serves the Vite build from ./dist
//   - proxies /gamma → gamma-api.polymarket.com and /clob → clob.polymarket.com
//     (the CLOB API sends no CORS headers, so the browser must hit it via this same-origin proxy)
//   - SPA fallback: unknown non-file routes return index.html
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain",
  ".map": "application/json", ".wasm": "application/wasm",
};

const PROXIES = { "/gamma": "gamma-api.polymarket.com", "/clob": "clob.polymarket.com" };

function proxy(req, res, host, path) {
  const headers = { ...req.headers, host };
  delete headers["accept-encoding"]; // avoid double-encoding surprises
  const upstream = httpsRequest({ host, path, method: req.method, headers }, (pres) => {
    res.writeHead(pres.statusCode || 502, pres.headers);
    pres.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end("upstream proxy error"); });
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { res.writeHead(400); return res.end(); }
  const pathname = url.pathname;

  // 1. API proxies
  for (const [prefix, host] of Object.entries(PROXIES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      const rest = pathname.slice(prefix.length) || "/";
      return proxy(req, res, host, rest + url.search);
    }
  }

  // 2. static file (only if it has an extension and exists)
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  if (extname(safe)) {
    try {
      const data = await readFile(join(DIST, safe));
      res.writeHead(200, {
        "Content-Type": MIME[extname(safe)] || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      return res.end(data);
    } catch { /* fall through to SPA */ }
  }

  // 3. SPA fallback → index.html
  try {
    const html = await readFile(join(DIST, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
  } catch {
    res.writeHead(404); res.end("not built — run `npm run build` first");
  }
});

server.listen(PORT, () => console.log(`[server] polybaskets-eth serving on :${PORT} (proxying /gamma, /clob)`));
