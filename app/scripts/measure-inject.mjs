// Measure how fast an injected CreateBasket commits (send() + poll GetBasketCount).
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
const PROGRAM = readFileSync(resolve(root, "app/.env"), "utf8").match(/VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/)[1];
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const acc = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pc = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
const wc = createWalletClient({ account: acc, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(pc, wc, env.ROUTER); await eth.isInitialized;
const prov = new WsVaraEthProvider(env.VARA_ETH_WS); await prov.connect();
const api = new VaraEthApi(prov, eth);
const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const svc = program.services.BasketMarket;

const count = async () => {
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROGRAM, svc.queries.GetBasketCount.encodePayload());
  return Number(svc.queries.GetBasketCount.decodeResult(r?.payload ?? r?.reply?.payload ?? "0x").toString());
};

const before = await count();
console.log("[measure] count before:", before);
// minimal CreateBasket payload (1 item, SCALE Vec<BasketItem>)
import { TypeRegistry } from "@polkadot/types";
const reg = new TypeRegistry();
reg.register({ Outcome: { _enum: ["Yes", "No"] }, BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" } });
const items = reg.createType("Vec<BasketItem>", [{ poly_market_id: "test", poly_slug: "test-slug", weight_bps: 10000, selected_outcome: "Yes" }]).toU8a();
const payload = svc.functions.CreateBasket.encodePayload("Speed Test", "latency probe", Array.from(items));

const t0 = Date.now();
const tx = await api.createInjectedTransaction({ destination: PROGRAM, payload, value: 0n });
const mid = await tx.send();
console.log(`[measure] submitted injected tx in ${Date.now() - t0}ms · msgId ${mid}`);

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  let now;
  try { now = await count(); } catch { continue; }
  if (now > before) {
    console.log(`[measure] ✅ basket visible after ${((Date.now() - t0) / 1000).toFixed(1)}s (count ${before} -> ${now})`);
    process.exit(0);
  }
}
console.log("[measure] ⚠️ not visible within 90s");
process.exit(1);
