// Operator bots runner for Railway — runs the wVARA relayer + Polymarket settler in one service,
// each auto-restarting on crash, with a /healthz HTTP endpoint bound to $PORT.
//   node scripts/bots.mjs        (or `npm run start:bots`)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const status = {};

function run(name, file) {
  status[name] = "running";
  const child = spawn(process.execPath, [resolve(here, file)], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => {
    status[name] = `exited(${code})`;
    console.log(`[bots] ${name} exited (code=${code}) — restarting in 5s`);
    setTimeout(() => run(name, file), 5000);
  });
}

run("relayer", "relayer.mjs");
run("settler", "settler.mjs");

createServer((req, res) => {
  if (["/healthz", "/health", "/"].includes(req.url)) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "polybaskets-eth-bots", status }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => console.log(`[bots] relayer + settler running · health on :${PORT}`));
