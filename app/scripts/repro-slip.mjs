// Reproduce the frontend placeSlip flow: createBasket (optimistic id) + bet, then check the position.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { TypeRegistry } from "@polkadot/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROG = readFileSync(resolve(root, "app/.env"), "utf8").match(/VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/)[1];
const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://ethereum-hoodi-rpc.publicnode.com"] } } });
const acc = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pc = createPublicClient({ chain: hoodi, transport: http() }), wc = createWalletClient({ account: acc, chain: hoodi, transport: http() });
const eth = new EthereumClient(pc, wc, env.ROUTER); await eth.isInitialized;
const prov = new WsVaraEthProvider(env.VARA_ETH_WS); await prov.connect();
const api = new VaraEthApi(prov, eth);
const parser = new SailsIdlParser(); await parser.init();
const p = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const svc = p.services.BasketMarket;
const actor = "0x" + acc.address.slice(2).toLowerCase().padStart(64, "0");
const log = (...a) => console.log("[repro]", ...a);

const count = async () => {
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetBasketCount.encodePayload());
  return Number(svc.queries.GetBasketCount.decodeResult(r?.payload ?? "0x").toString());
};
const send = async (name, args) => {
  const tx = await api.createInjectedTransaction({ destination: PROG, payload: svc.functions[name].encodePayload(...args), value: 0n });
  return tx.send();
};

const reg = new TypeRegistry();
reg.register({ Outcome: { _enum: ["Yes", "No"] }, BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" } });
const items = reg.createType("Vec<BasketItem>", [{ poly_market_id: "t", poly_slug: "repro-slug", weight_bps: 10000, selected_outcome: "Yes" }]).toU8a();

// EXACTLY like the frontend: createBasket returns optimistic id = count before; then bet immediately.
const before = await count();
log("count before:", before, "(optimistic new id =", before + ")");
const c1 = await send("CreateBasket", ["Repro Slip", "wvara bet test", Array.from(items)]);
log("CreateBasket ->", c1);
const betAmt = 1_000_000_000n; // 0.001 wVARA (deployer has 10)
const c2 = await send("BetOnBasket", [before, 1, betAmt, 5000]); // collateral=1 (wVARA)
log("BetOnBasket(wVARA, basket=" + before + ") ->", c2);

// poll for the position
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetPositions.encodePayload(actor));
  const raw = svc.queries.GetPositions.decodeResult(r?.payload ?? "0x");
  const hex = raw?.toHex ? raw.toHex() : String(raw);
  const cnt = await count();
  log(`t=${(i + 1) * 3}s count=${cnt} positions-blob-len=${hex.length}`);
  if (hex.length > 4) { log("✅ POSITION FOUND. blob:", hex.slice(0, 80)); process.exit(0); }
}
log("⚠️ no position after 120s");
process.exit(1);
