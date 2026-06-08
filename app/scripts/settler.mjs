// Settler bot for PolyBaskets-ETH.
//   - polls every Active basket; when ALL legs have resolved on Polymarket, ProposeSettlement
//   - finalizes SettlementPending baskets once the challenge window has passed
// Settlement index = Σ weight_i · (1 if the basket's pick matched the real resolution else 0).
// Signs with the settler key (the deployer). Run: node scripts/settler.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider, getMirrorClient } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { TypeRegistry } from "@polkadot/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROGRAM = readFileSync(resolve(root, "app/.env"), "utf8").match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const GAMMA = "https://gamma-api.polymarket.com";
const { ROUTER, VARA_ETH_WS } = env;
const POLL_MS = 30_000;
const log = (...a) => console.log("[settler]", new Date().toISOString().slice(11, 19), ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const reg = new TypeRegistry();
reg.register({
  Outcome: { _enum: ["Yes", "No"] },
  BasketStatus: { _enum: ["Active", "SettlementPending", "Settled"] },
  SettlementStatus: { _enum: ["Proposed", "Finalized"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
  Basket: { id: "u64", creator: "[u8;32]", name: "Text", description: "Text", items: "Vec<BasketItem>", created_at: "u64", status: "BasketStatus" },
  Settlement: { basket_id: "u64", proposer: "[u8;32]", item_resolutions: "Vec<Outcome>", index_bps: "u16", proposed_at: "u64", challenge_deadline: "u64", finalized_at: "Option<u64>", status: "SettlementStatus" },
});

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);
const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const svc = program.services.BasketMarket;
const mirror = getMirrorClient(PROGRAM, walletClient, publicClient);

async function query(name, ...args) {
  const payload = svc.queries[name].encodePayload(...args);
  const r = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, payload);
  return svc.queries[name].decodeResult(r?.payload ?? r?.reply?.payload ?? "0x");
}
function blob(decoded) {
  const v = decoded?.ok ?? decoded;
  if (v?.toU8a) return v.toU8a(true);
  if (typeof v === "string") return Uint8Array.from(v.replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16)));
  return Uint8Array.from(v);
}
async function write(name, ...args) {
  // fire-and-continue (don't block on the async Vara.eth reply)
  const tx = await mirror.sendMessage(svc.functions[name].encodePayload(...args), 0n);
  return tx.send();
}

/** Polymarket resolution of one market by slug: 'Yes' | 'No' | null (unresolved). */
async function resolutionOf(slug) {
  try {
    const r = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`);
    const m = (await r.json())?.[0];
    if (!m || !m.closed) return null;
    const p = JSON.parse(m.outcomePrices || "[]").map(Number);
    if (p.length < 2) return null;
    if (p[0] >= 0.99) return "Yes";
    if (p[1] >= 0.99) return "No";
    return null;
  } catch { return null; }
}

async function tick() {
  const count = Number((await query("GetBasketCount")).toString());
  const now = Date.now();
  for (let id = 0; id < count; id++) {
    let basket;
    try { basket = reg.createType("Basket", blob(await query("GetBasket", id))); } catch { continue; }
    const status = basket.status.toString();

    if (status === "Active") {
      // resolve every leg
      const resolutions = [];
      let allResolved = true, indexBps = 0;
      for (const it of basket.items) {
        const res = await resolutionOf(it.poly_slug.toString());
        if (!res) { allResolved = false; break; }
        resolutions.push(res);
        const pick = it.selected_outcome.toString();
        if (pick === res) indexBps += it.weight_bps.toNumber();
      }
      if (!allResolved) continue;
      log(`basket #${id} all legs resolved → propose (index ${indexBps} bps)`);
      const itemBytes = reg.createType("Vec<Outcome>", resolutions).toU8a();
      await write("ProposeSettlement", id, Array.from(itemBytes), Math.min(10000, indexBps));
      log(`  ✓ proposed`);
    } else if (status === "SettlementPending") {
      let s;
      try {
        const opt = reg.createType("Option<Settlement>", blob(await query("GetSettlement", id)));
        if (opt.isNone) continue;
        s = opt.unwrap();
      } catch { continue; }
      if (s.status.toString() === "Proposed" && now >= Number(s.challenge_deadline.toString())) {
        log(`basket #${id} challenge window passed → finalize`);
        await write("FinalizeSettlement", id);
        log(`  ✓ finalized`);
      }
    }
  }
}

log("started. program", PROGRAM);
for (;;) {
  try { await tick(); } catch (e) { log("error:", e.message?.slice(0, 120)); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
