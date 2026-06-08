// Prove the full write path on the live program: injected CreateBasket via sails-js encoding.
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
const appEnv = readFileSync(resolve(root, "app/.env"), "utf8");
const PROGRAM = appEnv.match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const { ROUTER, VARA_ETH_WS } = env;
const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });

// inner SCALE type for Vec<BasketItem> (not in IDL — encoded as [u8] blob)
const reg = new TypeRegistry();
reg.register({
  Outcome: { _enum: ["Yes", "No"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
});
const itemsBlob = reg.createType("Vec<BasketItem>", [
  { poly_market_id: "will-spain-win-wc", poly_slug: "spain-wc", weight_bps: 6000, selected_outcome: "Yes" },
  { poly_market_id: "will-france-win-wc", poly_slug: "france-wc", weight_bps: 4000, selected_outcome: "Yes" },
]).toU8a();

const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);

const countFn = program.services.BasketMarket.queries.GetBasketCount;
const read = async () => {
  const r = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, countFn.encodePayload());
  return countFn.decodeResult(r?.payload ?? r?.reply?.payload ?? "0x").toString();
};
console.log("[test] GetBasketCount before:", await read());

const createFn = program.services.BasketMarket.functions.CreateBasket;
const payload = createFn.encodePayload("WC26 Favourites", "Spain 60% / France 40%", Array.from(itemsBlob));
console.log("[test] injected CreateBasket payload", payload.slice(0, 50) + "…");
const injected = await api.createInjectedTransaction({ destination: PROGRAM, payload, value: 0n });
const promise = await injected.sendAndWaitForPromise();
console.log("[test] injected promise code:", JSON.stringify(promise?.code ?? promise?.status ?? "?"));

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const c = await read().catch(() => "?");
  if (c !== "0" && c !== "?") { console.log("[test] ✅ GetBasketCount AFTER:", c, "— write path works end-to-end!"); process.exit(0); }
  console.log(`[test]   …count still ${c} (${(i + 1) * 4}s)`);
}
console.log("[test] ⚠️ count did not increment in time");
process.exit(1);
