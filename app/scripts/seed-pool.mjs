// Seed the operator house pool: 0.5 ETH + 200 WTVARA (operator-only, classic txs).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, VaraEthApi, WsVaraEthProvider, getMirrorClient } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROGRAM = readFileSync(resolve(root, "app/.env"), "utf8").match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const { ROUTER, VARA_ETH_WS } = env;
const WTVARA = env.WVARA || "0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464";
const SEED_ETH = parseEther("0.5");
const SEED_WTVARA = 200n * 1_000_000_000_000n; // 200 WTVARA (12 dec)
const log = (...a) => console.log("[seed]", ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const ERC20 = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }];

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETH_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);
const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const mirror = getMirrorClient(PROGRAM, walletClient, publicClient);
const svc = program.services.BasketMarket;

async function send(label, payload, value) {
  log(`${label} …`);
  const tx = await mirror.sendMessage(payload, value);
  const h = await tx.send();
  log(`  tx ${h}`);
  return h;
}

// 1. Seed ETH pool (payable)
await send("SeedPoolEth 0.5 ETH", svc.functions.SeedPoolEth.encodePayload(), SEED_ETH);

// 2. Seed WTVARA pool (approve + message)
const ah = await walletClient.writeContract({ address: WTVARA, abi: ERC20, functionName: "approve", args: [PROGRAM, SEED_WTVARA] });
await publicClient.waitForTransactionReceipt({ hash: ah });
log("approved 200 WTVARA");
await send("SeedPoolWvara 200", svc.functions.SeedPoolWvara.encodePayload(SEED_WTVARA), 0n);

// 3. verify pools (poll a bit for state commitment)
const ethPool = svc.queries.GetPool, src = account.address;
const readPool = async (c) => {
  const r = await api.call.program.calculateReplyForHandle(src, PROGRAM, ethPool.encodePayload(c));
  const v = ethPool.decodeResult(r?.payload ?? r?.reply?.payload ?? "0x");
  return (v?.ok ?? v).toString();
};
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const e = await readPool(0), w = await readPool(1);
    log(`pool[Eth]=${e}  pool[Wvara]=${w}`);
    if (e !== "0" || w !== "0") { log("✅ pools seeded"); break; }
  } catch (err) { log("  poll:", err.message?.slice(0, 50)); }
}
process.exit(0);
