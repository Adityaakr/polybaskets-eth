// Seed N wVARA into the house pool: transfer to the vault (real backing) + SeedPoolWvara(N).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider, getMirrorClient } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";

const AMOUNT = BigInt(process.argv[2] ?? "2000") * 1_000_000_000_000n; // wVARA, 12 dec
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROG = readFileSync(resolve(root, "app/.env"), "utf8").match(/VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/)[1];
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const { ROUTER, VARA_ETH_WS, WVARA, WVARA_VAULT } = env;
const log = (...a) => console.log("[seed]", ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const ERC20 = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const acc = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const pc = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) }), wc = createWalletClient({ account: acc, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(pc, wc, ROUTER); await eth.isInitialized;
const prov = new WsVaraEthProvider(VARA_ETH_WS); await prov.connect();
const api = new VaraEthApi(prov, eth);
const parser = new SailsIdlParser(); await parser.init();
const p = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const svc = p.services.BasketMarket;
const mirror = getMirrorClient(PROG, wc, pc);

log(`seeding ${AMOUNT / 1_000_000_000_000n} wVARA`);
// 1. transfer to vault (real backing)
const th = await wc.writeContract({ address: WVARA, abi: ERC20, functionName: "transfer", args: [WVARA_VAULT, AMOUNT] });
await pc.waitForTransactionReceipt({ hash: th });
log(`✓ transferred to vault ${th}`);
const held = await pc.readContract({ address: WVARA, abi: ERC20, functionName: "balanceOf", args: [WVARA_VAULT] });
log(`vault now holds ${held / 1_000_000_000_000n} wVARA`);

// 2. credit the pool ledger
const tx = await mirror.sendMessage(svc.functions.SeedPoolWvara.encodePayload(AMOUNT), 0n);
log(`SeedPoolWvara tx ${await tx.send()}`);

// 3. verify pool
const gp = async () => {
  const r = await api.call.program.calculateReplyForHandle(acc.address, PROG, svc.queries.GetPool.encodePayload(1));
  const v = svc.queries.GetPool.decodeResult(r?.payload ?? "0x");
  return (v?.ok ?? v).toString();
};
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const pool = await gp().catch(() => "0");
  log(`pool wVARA = ${(Number(pool) / 1e12).toFixed(0)} (${(i + 1) * 5}s)`);
  if (Number(pool) >= 2000_000_000_000_000) { log("✅ pool seeded"); process.exit(0); }
}
log("⚠️ pool not updated yet (will commit shortly)"); process.exit(0);
