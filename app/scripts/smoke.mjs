// Smoke-read the deployed BasketMarket using correct sails-js 1.0 encoding.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROGRAM = readFileSync(resolve(root, "app/.env"), "utf8").match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const { ROUTER, ETHEREUM_RPC, VARA_ETH_WS } = env;
const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETHEREUM_RPC] } } });

const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETHEREUM_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETHEREUM_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);

async function q(name, fn, ...args) {
  const payload = fn.encodePayload(...args);
  const reply = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, payload);
  const raw = reply?.payload ?? reply?.reply?.payload ?? "0x";
  try { return fn.decodeResult(raw); } catch { return "raw:" + raw; }
}

console.log("[smoke] program", PROGRAM);
console.log("[smoke] GetBasketCount =", await q("GetBasketCount", program.services.BasketMarket.queries.GetBasketCount));
console.log("[smoke] GetConfig =", JSON.stringify(await q("GetConfig", program.services.BasketMarket.queries.GetConfig)));
process.exit(0);
