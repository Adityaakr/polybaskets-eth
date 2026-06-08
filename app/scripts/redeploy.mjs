// Clean redeploy: fresh program from the already-validated code, init correctly on first message.
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
const { ROUTER, ETHEREUM_RPC, VARA_ETH_WS } = env;
const WTVARA = env.WVARA || "0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464";
const CODE_ID = process.env.CODE_ID || "0xab37e421d03b36066362c3fd8e4b2215d2448d8099783116d0654906ef406c3f";
const TOPUP = 300n * 1_000_000_000_000n; // 300 WTVARA executable balance
const log = (...a) => console.log("[redeploy]", ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETHEREUM_RPC] } } });
const ERC20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETHEREUM_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETHEREUM_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const provider = new WsVaraEthProvider(VARA_ETH_WS); await provider.connect();
const api = new VaraEthApi(provider, eth);

const parser = new SailsIdlParser(); await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const actorId = "0x" + account.address.slice(2).toLowerCase().padStart(64, "0");

// 1. create fresh program
log("createProgram from validated code…");
const cp = await eth.router.createProgram(CODE_ID);
await cp.sendAndWaitForReceipt();
const programId = await cp.getProgramId();
log("✓ programId", programId);

const mirror = getMirrorClient(programId, walletClient, publicClient);

// 2. executable balance
log("approve + executableBalanceTopUp", TOPUP.toString(), "…");
const ah = await walletClient.writeContract({ address: WTVARA, abi: ERC20, functionName: "approve", args: [programId, TOPUP] });
await publicClient.waitForTransactionReceipt({ hash: ah });
const tu = await mirror.executableBalanceTopUp(TOPUP);
await (tu.sendAndWaitForReceipt?.() ?? tu.send?.());
log("✓ topped up");

// 3. init (FIRST message must be the constructor)
const initPayload = program.ctors.Init.encodePayload(actorId, 720);
log("init payload", initPayload);
const itx = await mirror.sendMessage(initPayload, 0n);
const ih = await itx.send();
log("init tx", ih);

// 4. verify by polling GetBasketCount until it decodes to 0 (initialized)
const countFn = program.services.BasketMarket.queries.GetBasketCount;
const cPayload = countFn.encodePayload();
let ok = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const reply = await api.call.program.calculateReplyForHandle(account.address, programId, cPayload);
    const raw = reply?.payload ?? reply?.reply?.payload ?? "0x";
    const txt = Buffer.from(raw.slice(2), "hex").toString("utf8");
    if (txt.includes("not initialized")) { log(`  …still initializing (${(i + 1) * 4}s)`); continue; }
    const count = countFn.decodeResult(raw);
    log("✓ INITIALIZED. GetBasketCount =", count.toString());
    ok = true;
    break;
  } catch (e) { log("  poll err:", e.message?.slice(0, 60)); }
}

// 5. persist
const envPath = resolve(root, "app/.env");
let ev = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const set = (k, v) => { ev = ev.match(new RegExp(`^${k}=.*$`, "m")) ? ev.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : ev.trimEnd() + `\n${k}=${v}`; };
set("VITE_ROUTER_ADDRESS", ROUTER); set("VITE_PROGRAM_ID", programId); set("VITE_WVARA_ADDRESS", WTVARA);
  set("VITE_WVARA_VAULT", "0xA91Ba5c6EDb2f2A9bBf7aa813049B1817A3B7287");
set("VITE_VARA_ETH_RPC", VARA_ETH_WS);
writeFileSync(envPath, ev.trim() + "\n");
log(ok ? "✅ DONE & VERIFIED. programId=" + programId : "⚠️ created but init not confirmed: " + programId);
process.exit(ok ? 0 : 1);
