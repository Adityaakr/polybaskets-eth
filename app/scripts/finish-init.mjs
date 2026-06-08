// Finish the already-created bridge program: top up (fits available wVARA) + init + persist env.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
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
const PROGRAM = process.env.PROGRAM_ID || "0xe3bead8473c4cd6fe59f4aee81aa446be271a101";
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const { ROUTER, VARA_ETH_WS } = env;
const WTVARA = env.WVARA;
const VAULT = env.WVARA_VAULT;
const TOPUP = 150n * 1_000_000_000_000n; // 150 wVARA (fits the 200 available, leaves 50)
const log = (...a) => console.log("[finish]", ...a);

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
const actorId = "0x" + account.address.slice(2).toLowerCase().padStart(64, "0");
const mirror = getMirrorClient(PROGRAM, walletClient, publicClient);

log("program", PROGRAM, "| topup", TOPUP.toString(), "wVARA");
const ah = await walletClient.writeContract({ address: WTVARA, abi: ERC20, functionName: "approve", args: [PROGRAM, TOPUP] });
await publicClient.waitForTransactionReceipt({ hash: ah });
const tu = await mirror.executableBalanceTopUp(TOPUP);
await (tu.sendAndWaitForReceipt?.() ?? tu.send?.());
log("✓ topped up");

const itx = await mirror.sendMessage(program.ctors.Init.encodePayload(actorId, 720), 0n);
log("init tx", await itx.send());

const countFn = program.services.BasketMarket.queries.GetBasketCount;
let ok = false;
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const reply = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, countFn.encodePayload());
    const raw = reply?.payload ?? reply?.reply?.payload ?? "0x";
    if (Buffer.from(raw.slice(2), "hex").toString("utf8").includes("not initialized")) { log(`  …initializing (${(i + 1) * 4}s)`); continue; }
    log("✓ INITIALIZED. GetBasketCount =", countFn.decodeResult(raw).toString());
    ok = true; break;
  } catch (e) { log("  poll:", e.message?.slice(0, 50)); }
}

const envPath = resolve(root, "app/.env");
let ev = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const set = (k, v) => { ev = ev.match(new RegExp(`^${k}=.*$`, "m")) ? ev.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : ev.trimEnd() + `\n${k}=${v}`; };
set("VITE_ROUTER_ADDRESS", ROUTER); set("VITE_PROGRAM_ID", PROGRAM); set("VITE_WVARA_ADDRESS", WTVARA);
set("VITE_WVARA_VAULT", VAULT); set("VITE_VARA_ETH_RPC", VARA_ETH_WS);
writeFileSync(envPath, ev.trim() + "\n");
log(ok ? "✅ DONE. programId=" + PROGRAM : "⚠️ created but init unconfirmed: " + PROGRAM);
process.exit(ok ? 0 : 1);
