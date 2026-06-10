// Read-only viewer for a PolyBaskets-ETH account on Vara.eth.
// Shows what the validator has recorded for an address: in-app balances + positions (bets) +
// the baskets behind them. This is the "Category B" view — injected bets never hit Hoodi as
// transactions, so this queries the Vara.eth program state directly (free, no signing, no key).
//
// Usage:  node scripts/read-account.mjs [0xADDRESS]
//   defaults to 0xcBfAca5CddD1c9F869Fe4981376a46196aB94B3F
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { EthereumClient, VaraEthApi, WsVaraEthProvider } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { TypeRegistry } from "@polkadot/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADDR = (process.argv[2] ?? "0xcBfAca5CddD1c9F869Fe4981376a46196aB94B3F").toLowerCase();

// Public config (no secrets). Env overrides if present.
const PROGRAM = (process.env.PROGRAM_ID ?? process.env.VITE_PROGRAM_ID ?? "0xe3bead8473c4cd6fe59f4aee81aa446be271a101").toLowerCase();
const ROUTER = process.env.ROUTER ?? "0xE549b0AfEdA978271FF7E712232B9F7f39A0b060";
const VARA_ETH_WS = process.env.VARA_ETH_WS ?? "wss://vara-eth-validator-1.gear-tech.io";
const ETH_RPC = process.env.ETHEREUM_RPC ?? process.env.ETH_RPC ?? "https://ethereum-hoodi-rpc.publicnode.com";

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });

const reg = new TypeRegistry();
reg.register({
  Collateral: { _enum: ["Eth", "Wvara"] },
  Outcome: { _enum: ["Yes", "No"] },
  BasketStatus: { _enum: ["Active", "SettlementPending", "Settled"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
  Basket: { id: "u64", creator: "[u8;32]", name: "Text", description: "Text", items: "Vec<BasketItem>", created_at: "u64", status: "BasketStatus" },
  Position: { basket_id: "u64", user: "[u8;32]", collateral: "Collateral", shares: "u128", index_at_creation_bps: "u16", claimed: "bool" },
});
const COLL = ["Eth", "Wvara"];
const actorId = (a) => `0x${a.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;

const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
// account = the address we're reading (read query "from"); no private key — we never sign.
const walletClient = createWalletClient({ account: ADDR, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);
const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "public/basket_market.idl"), "utf8")));
const svc = program.services.BasketMarket;

async function query(name, ...args) {
  const payload = svc.queries[name].encodePayload(...args);
  const r = await api.call.program.calculateReplyForHandle(ADDR, PROGRAM, payload);
  return svc.queries[name].decodeResult(r?.payload ?? r?.reply?.payload ?? "0x");
}
function blob(decoded) {
  const v = decoded?.ok ?? decoded;
  if (v?.toU8a) return v.toU8a(true);
  if (typeof v === "string") return Uint8Array.from(v.replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16)));
  return Uint8Array.from(v);
}

console.log(`\nAccount ${ADDR}`);
console.log(`Program ${PROGRAM}  (Vara.eth / Hoodi)\n`);

// 1) in-app balances (this is what the relayer credits after a wVARA deposit)
const balances = reg.createType("Vec<(Collateral, u128)>", blob(await query("GetBalances", actorId(ADDR))));
console.log("== Balances (in-app, credited) ==");
if (balances.length === 0) console.log("  (none)");
for (const pair of balances) {
  const sym = COLL[pair[0].index] ?? "?";
  const raw = BigInt(pair[1].toString());
  const human = sym === "Wvara" ? Number(raw) / 1e12 : Number(raw) / 1e18;
  console.log(`  ${sym}: ${human}  (raw ${raw})`);
}

// 2) positions = the bets you signed (injected, never on Hoodi as a tx)
const positions = reg.createType("Vec<Position>", blob(await query("GetPositions", actorId(ADDR))));
console.log(`\n== Positions / bets (${positions.length}) ==`);
if (positions.length === 0) console.log("  (none)");
for (const p of positions) {
  console.log(`  basket #${p.basket_id}  ${COLL[p.collateral.index]}  shares=${p.shares}  entryIndexBps=${p.index_at_creation_bps}  claimed=${p.claimed.isTrue}`);
}

// 3) TRACK each position: live Polymarket price per leg -> current basket index vs your entry
//    index. payout scales as current_index / entry_index, so >1.0 = up, <1.0 = down.
const GAMMA = "https://gamma-api.polymarket.com";
const priceCache = new Map();
async function legPrice(slug, outcome) {
  // returns probability (0..1) of the selected outcome, or null if unresolved/unknown
  if (!priceCache.has(slug)) {
    try {
      const r = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`);
      priceCache.set(slug, (await r.json())?.[0] ?? null);
    } catch { priceCache.set(slug, null); }
  }
  const m = priceCache.get(slug);
  if (!m) return null;
  try {
    const outs = JSON.parse(m.outcomes || "[]");          // e.g. ["Yes","No"]
    const prices = JSON.parse(m.outcomePrices || "[]").map(Number);
    const i = outs.findIndex((o) => o.toLowerCase() === outcome.toLowerCase());
    return i >= 0 ? prices[i] : null;
  } catch { return null; }
}

const byBasket = new Map(positions.map((p) => [p.basket_id.toString(), p]));
const ids = [...byBasket.keys()];
if (ids.length) {
  console.log(`\n== Tracking your bets (live Polymarket prices) ==`);
  for (const id of ids) {
    const pos = byBasket.get(id);
    try {
      const b = reg.createType("Basket", blob(await query("GetBasket", id)));
      // current index (bps) = Σ weight_bps_i · price_i ; null leg = unresolved/unknown
      let cur = 0, known = true;
      const legLines = [];
      for (const it of b.items) {
        const p = await legPrice(it.poly_slug.toString(), it.selected_outcome.toString());
        if (p == null) { known = false; legLines.push(`     - ${it.selected_outcome} @ ${it.weight_bps}bps  ${it.poly_slug}  (price n/a)`); continue; }
        cur += it.weight_bps.toNumber() * p;
        legLines.push(`     - ${it.selected_outcome} @ ${it.weight_bps}bps  ${it.poly_slug}  now ${(p * 100).toFixed(1)}%`);
      }
      const entry = pos.index_at_creation_bps.toNumber();
      const ratio = known && entry > 0 ? cur / entry : null;
      const arrow = ratio == null ? "?" : ratio > 1.001 ? "▲ UP" : ratio < 0.999 ? "▼ DOWN" : "→ flat";
      const pct = ratio == null ? "n/a" : `${((ratio - 1) * 100).toFixed(1)}%`;
      console.log(`\n  #${b.id} "${b.name}"  [${b.status}]  ${pos.collateral.index === 1 ? "wVARA" : "ETH"} bet`);
      console.log(`     entry index ${entry}bps  ->  current ${known ? cur.toFixed(0) + "bps" : "n/a"}   ${arrow} ${pct}`);
      legLines.forEach((l) => console.log(l));
    } catch (e) {
      console.log(`  #${id}  (could not read: ${e?.message ?? e})`);
    }
  }
  console.log(`\n  ▲/▼ = current value vs your entry. Final payout = shares × settlement_index / entry_index,`);
  console.log(`  settled only when ALL legs resolve on Polymarket (status flips Active -> SettlementPending -> Settled).`);
}

console.log();
await provider.disconnect?.();
process.exit(0);
