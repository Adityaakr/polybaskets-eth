// Verify the FIX: create → wait for committed basket (creator+name) → bet → confirm position.
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
const log = (...a) => console.log("[fix]", ...a);

const reg = new TypeRegistry();
reg.register({ Outcome: { _enum: ["Yes", "No"] }, BasketStatus: { _enum: ["Active", "SettlementPending", "Settled"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
  Basket: { id: "u64", creator: "[u8;32]", name: "Text", description: "Text", items: "Vec<BasketItem>", created_at: "u64", status: "BasketStatus" } });

const send = async (name, args) => (await api.createInjectedTransaction({ destination: PROG, payload: svc.functions[name].encodePayload(...args), value: 0n })).send();
const count = async () => Number(svc.queries.GetBasketCount.decodeResult((await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetBasketCount.encodePayload()))?.payload ?? "0x").toString());
const getBasket = async (id) => {
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetBasket.encodePayload(id));
  const raw = svc.queries.GetBasket.decodeResult(r?.payload ?? "0x");
  const hex = raw?.toHex ? raw.toHex() : raw; const bytes = Uint8Array.from(hex.replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16)));
  try { return reg.createType("Basket", bytes); } catch { return null; }
};

const NAME = "Fix Verify " + (await count());
const items = reg.createType("Vec<BasketItem>", [{ poly_market_id: "t", poly_slug: "fix-slug", weight_bps: 10000, selected_outcome: "Yes" }]).toU8a();
const before = new Set(); const c0 = await count(); for (let i = 0; i < c0; i++) before.add(i);

log("submitting CreateBasket name=", NAME);
log("CreateBasket ->", await send("CreateBasket", [NAME, "fix", Array.from(items)]));

// wait for MY committed basket
let bid = null;
for (let i = 0; i < 40 && bid == null; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const c = await count();
  for (let id = c0; id < c; id++) {
    if (before.has(id)) continue;
    const b = await getBasket(id);
    if (b && b.name.toString() === NAME && b.creator.toHex().toLowerCase().endsWith(actor.slice(2))) { bid = id; break; }
  }
  log(`t=${(i + 1) * 3}s count=${c} myBasket=${bid}`);
}
if (bid == null) { log("⚠️ basket never committed"); process.exit(1); }
log("✅ my basket committed at id", bid, "— now betting wVARA");
log("BetOnBasket(wVARA, basket=" + bid + ") ->", await send("BetOnBasket", [bid, 1, 1_000_000_000n, 5000]));

// confirm position
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetPositions.encodePayload(actor));
  const hex = svc.queries.GetPositions.decodeResult(r?.payload ?? "0x").toHex();
  if (hex.length > 4) { log(`✅✅ POSITION REGISTERED after ${(i + 1) * 3}s — blob ${hex.slice(0, 60)}`); process.exit(0); }
  log(`t=${(i + 1) * 3}s waiting for position…`);
}
log("⚠️ position never appeared"); process.exit(1);
