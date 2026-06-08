// Shared config loader for the operator bots (relayer, settler).
// Priority: process.env (Railway variables) → deploy/.env.deploy (local) → app/.env / defaults.
// This lets the same scripts run locally (reading the gitignored key file) AND on Railway
// (reading env vars, with the private key set as a private/secret variable).
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseEnvFile(rel) {
  const p = resolve(root, rel);
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const deployFile = parseEnvFile("deploy/.env.deploy");
const appEnvRaw = existsSync(resolve(root, "app/.env")) ? readFileSync(resolve(root, "app/.env"), "utf8") : "";
const programFromAppEnv = appEnvRaw.match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)?.[1];

const pick = (key, fallback) => process.env[key] ?? deployFile[key] ?? fallback;

export const cfg = {
  DEPLOYER_PRIVATE_KEY: pick("DEPLOYER_PRIVATE_KEY"),
  ROUTER: pick("ROUTER", "0xE549b0AfEdA978271FF7E712232B9F7f39A0b060"),
  WVARA: pick("WVARA", "0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464"),
  WVARA_VAULT: pick("WVARA_VAULT", "0xA91Ba5c6EDb2f2A9bBf7aa813049B1817A3B7287"),
  VARA_ETH_WS: pick("VARA_ETH_WS", "wss://vara-eth-validator-1.gear-tech.io"),
  ETH_RPC: pick("ETHEREUM_RPC", "https://ethereum-hoodi-rpc.publicnode.com"),
  PROGRAM_ID: process.env.PROGRAM_ID ?? process.env.VITE_PROGRAM_ID ?? deployFile.PROGRAM_ID ?? programFromAppEnv,
};

export function assertConfigured() {
  const missing = ["DEPLOYER_PRIVATE_KEY", "ROUTER", "WVARA_VAULT", "VARA_ETH_WS", "PROGRAM_ID"].filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(`Missing config: ${missing.join(", ")}. Set them as env vars (Railway) or in deploy/.env.deploy (local).`);
  }
}
