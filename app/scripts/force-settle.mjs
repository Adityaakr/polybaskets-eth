// Force-settle a basket for DEMO/testing (operator only): propose a settlement with a chosen
// outcome, wait the challenge window, then finalize — so the claim flow can be exercised before
// real Polymarket resolutions exist.
//   node scripts/force-settle.mjs <basketId> [win|lose|partial]
//     win     = every leg resolves in the basket's favour (index = Σ weights → max payout)
//     lose    = every leg resolves against (index = 0)
//     partial = first leg wins, rest lose
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider, getMirrorClient } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";
import { TypeRegistry } from "@polkadot/types";

const basketId = Number(process.argv[2] ?? "0");
const mode = (process.argv[3] ?? "win").toLowerCase();

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
const mirror = getMirrorClient(PROG, wc, pc);
const acct = acc.address;
const log = (...a) => console.log("[force-settle]", ...a);

const reg = new TypeRegistry();
reg.register({ Outcome: { _enum: ["Yes", "No"] }, BasketStatus: { _enum: ["Active", "SettlementPending", "Settled"] }, SettlementStatus: { _enum: ["Proposed", "Finalized"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
  Basket: { id: "u64", creator: "[u8;32]", name: "Text", description: "Text", items: "Vec<BasketItem>", created_at: "u64", status: "BasketStatus" },
  Settlement: { basket_id: "u64", proposer: "[u8;32]", item_resolutions: "Vec<Outcome>", index_bps: "u16", proposed_at: "u64", challenge_deadline: "u64", finalized_at: "Option<u64>", status: "SettlementStatus" } });

const bytesOf = (dec) => { const v = dec?.ok ?? dec; const hex = v?.toHex ? v.toHex() : v; return Uint8Array.from(String(hex).replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16))); };
const getBasket = async () => reg.createType("Basket", bytesOf(svc.queries.GetBasket.decodeResult((await api.call.program.calculateReplyForHandle(acct, PROG, svc.queries.GetBasket.encodePayload(basketId)))?.payload ?? "0x")));
const getSettlement = async () => { const o = reg.createType("Option<Settlement>", bytesOf(svc.queries.GetSettlement.decodeResult((await api.call.program.calculateReplyForHandle(acct, PROG, svc.queries.GetSettlement.encodePayload(basketId)))?.payload ?? "0x"))); return o.isSome ? o.unwrap() : null; };
const send = async (name, args) => { const tx = await mirror.sendMessage(svc.functions[name].encodePayload(...args), 0n); return tx.send(); };

const basket = await getBasket();
log(`basket #${basketId} "${basket.name}" status=${basket.status} legs=${basket.items.length}`);

// build resolutions + index
const resolutions = [];
let indexBps = 0;
basket.items.forEach((it, i) => {
  const pick = it.selected_outcome.toString(); // Yes/No
  const win = mode === "win" || (mode === "partial" && i === 0);
  const res = win ? pick : (pick === "Yes" ? "No" : "Yes"); // matches pick if win
  resolutions.push(res);
  if (win) indexBps += it.weight_bps.toNumber();
});
indexBps = Math.min(10000, indexBps);
log(`mode=${mode} → resolutions=[${resolutions}] index_bps=${indexBps}`);

const itemBytes = Array.from(reg.createType("Vec<Outcome>", resolutions).toU8a());

if (basket.status.toString() === "Active") {
  log("ProposeSettlement ->", await send("ProposeSettlement", [basketId, itemBytes, indexBps]));
  log("waiting for proposal to commit…");
} else {
  log("basket not Active — skipping propose (already proposed/settled)");
}

// poll until proposed, then wait challenge window, then finalize
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await getSettlement().catch(() => null);
  if (!s) { log(`t=${(i + 1) * 5}s no settlement yet…`); continue; }
  const deadline = Number(s.challenge_deadline.toString());
  const left = Math.max(0, deadline - Date.now());
  if (s.status.toString() === "Finalized") { log("✅ already finalized · index", s.index_bps.toString()); process.exit(0); }
  if (left > 0) { log(`proposed · challenge window ${Math.ceil(left / 1000)}s left…`); continue; }
  log("challenge window passed → FinalizeSettlement ->", await send("FinalizeSettlement", [basketId]));
  // confirm
  for (let j = 0; j < 30; j++) {
    await new Promise((r) => setTimeout(r, 5000));
    const f = await getSettlement().catch(() => null);
    if (f?.status.toString() === "Finalized") { log("✅✅ FINALIZED · index", f.index_bps.toString(), "— claim is now available in the portfolio"); process.exit(0); }
    log(`t finalize ${(j + 1) * 5}s…`);
  }
  break;
}
log("⚠️ did not finalize in time"); process.exit(1);
