// Seed the new program's pools: ETH pool (real value) + wVARA pool (backed by tokens in the vault).
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
const { ROUTER, VARA_ETH_WS, WVARA, WVARA_VAULT } = env;
const SEED_ETH = parseEther("0.15");
const SEED_WVARA = 30n * 1_000_000_000_000n; // 30 wVARA, transferred to the vault as backing
const log = (...a) => console.log("[pools]", ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const ERC20 = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }];

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

async function send(name, args, value) {
  const tx = await mirror.sendMessage(svc.functions[name].encodePayload(...args), value);
  const h = await tx.send();
  log(`${name} tx ${h}`);
}

// 1. ETH pool (real value attached)
await send("SeedPoolEth", [], SEED_ETH);
// 2. fund the vault with real wVARA backing
const th = await walletClient.writeContract({ address: WVARA, abi: ERC20, functionName: "transfer", args: [WVARA_VAULT, SEED_WVARA] });
await publicClient.waitForTransactionReceipt({ hash: th });
log(`transferred ${SEED_WVARA} wVARA -> vault (${th})`);
// 3. wVARA pool ledger credit (now backed by the vault)
await send("SeedPoolWvara", [SEED_WVARA], 0n);

// verify pools (poll for commit)
const q = svc.queries.GetPool;
const read = async (c) => {
  const r = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, q.encodePayload(c));
  const v = q.decodeResult(r?.payload ?? r?.reply?.payload ?? "0x");
  return (v?.ok ?? v).toString();
};
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const e = await read(0), w = await read(1);
    log(`pool[Eth]=${e} pool[Wvara]=${w}`);
    if (e !== "0" && w !== "0") { log("✅ pools seeded + vault funded"); break; }
  } catch (err) { log("poll:", err.message?.slice(0, 50)); }
}
process.exit(0);
