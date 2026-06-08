// PolyBaskets-ETH contract deploy to Hoodi via @vara-eth/api (no ethexe CLI needed).
//
//   1. requestCodeValidation(wasm) -> codeId
//   2. createProgram(codeId)       -> programId
//   3. approve wVARA + executableBalanceTopUp  (program execution fuel)
//   4. sendMessage(Init payload)   -> initialize (settler_role, liveness)
//   5. seed the ETH house pool
//   6. write VITE_PROGRAM_ID back into app/.env
//
// Run from polybaskets-eth/app:  node scripts/deploy.mjs
// Reads secrets from ../deploy/.env.deploy (gitignored).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, getMirrorClient } from "@vara-eth/api";
import { TypeRegistry } from "@polkadot/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");

// ---- config -----------------------------------------------------------------
function loadDeployEnv() {
  const p = resolve(root, "deploy/.env.deploy");
  if (!existsSync(p)) throw new Error(`Missing ${p}`);
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
  }
  return env;
}
const E = loadDeployEnv();
const ETH_RPC = E.ETHEREUM_RPC;
const ROUTER = E.ROUTER;
const PK = E.DEPLOYER_PRIVATE_KEY;
const WASM_PATH = resolve(root, "contract/target/wasm32-gear/release/basket_market.opt.wasm");

const WVARA_ADDR = process.env.WVARA || "0xE1ab85A8B4d5d5B6af0bbD0203EB322DF33d0464"; // WTVARA (router 0xE549)
const LIVENESS_SECONDS = 720n; // 12-minute challenge window
const TOPUP_TARGET_WVARA = 500n * 1_000_000_000_000n; // up to 500 WTVARA (12 dec) for executable balance
const SEED_POOL_ETH = process.env.SEED_ETH ? BigInt(process.env.SEED_ETH) : 0n;
// Resume: if app/.env already has a program id, skip validate+create and go to top-up/init.
function existingProgramId() {
  const p = resolve(root, "app/.env");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]{40,})\s*$/m);
  return m ? m[1] : null;
}

const hoodi = defineChain({
  id: 560048,
  name: "Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ETH_RPC] } },
});

const registry = new TypeRegistry();
function addressToActorId(addr) {
  return `0x${addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}
// Sails constructor payload: (String ctorName, ...args). settler_role: [u8;32], liveness: u64.
function encodeInit(settlerActorId, liveness) {
  return registry.createType("(Text, [u8;32], u64)", ["Init", settlerActorId, liveness]).toHex();
}
// Service call envelope: (String service, String method, ...args).
function encodeCall(method, types, values) {
  return registry.createType(`(Text, Text${types.length ? ", " + types.join(", ") : ""})`, ["BasketMarket", method, ...values]).toHex();
}

const log = (...a) => console.log("[deploy]", ...a);

async function main() {
  if (!PK || PK.includes("...")) throw new Error("Set DEPLOYER_PRIVATE_KEY in deploy/.env.deploy");
  const wasm = new Uint8Array(readFileSync(WASM_PATH));
  log(`wasm ${WASM_PATH} (${wasm.length} bytes)`);

  const account = privateKeyToAccount(PK);
  log("deployer", account.address);
  const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
  const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETH_RPC) });

  const bal = await publicClient.getBalance({ address: account.address });
  log("ETH balance", bal.toString());
  if (bal === 0n) throw new Error("Deployer has 0 ETH on Hoodi — fund it first.");

  const eth = new EthereumClient(publicClient, walletClient, ROUTER);
  await eth.isInitialized;

  // Code already validated out-of-band (uploaded via gear-idea). Skip the blob upload entirely.
  const CODE_ID = process.env.CODE_ID || "0xc2569be9076c558caa0f00dbe6a486d65ef01333f48a53016689b5c30d7a7a15";
  const codeState = await eth.router.codeState(CODE_ID).catch(() => null);
  log("codeState", codeState, "(expect Validated)");

  let programId = existingProgramId();
  if (programId) {
    log("RESUME: existing programId", programId, "— skipping create");
  } else {
    log("createProgram from validated codeId", CODE_ID, "…");
    const cp = await eth.router.createProgram(CODE_ID);
    await cp.sendAndWaitForReceipt();
    programId = await cp.getProgramId();
    log("✓ programId", programId);
    writeProgramEnv(programId); // persist before init so a crash doesn't orphan the program
  }

  const mirror = getMirrorClient(programId, walletClient, publicClient);

  // 3. executable balance top-up (needs wVARA)
  const ERC20 = [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  ];
  const wvaraBal = await publicClient.readContract({ address: WVARA_ADDR, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  log("wVARA balance", wvaraBal.toString());
  let topupOk = false;
  if (wvaraBal === 0n) {
    log("⚠️ no wVARA — skipping top-up + init. Fund deployer with wVARA and rerun (resumes).");
  } else {
    const amount = wvaraBal < TOPUP_TARGET_WVARA ? wvaraBal : TOPUP_TARGET_WVARA;
    try {
      log(`approving ${amount} wVARA to program…`);
      const h = await walletClient.writeContract({ address: WVARA_ADDR, abi: ERC20, functionName: "approve", args: [programId, amount] });
      await publicClient.waitForTransactionReceipt({ hash: h });
      log("executableBalanceTopUp…");
      const tx = await mirror.executableBalanceTopUp(amount);
      await (tx.sendAndWaitForReceipt?.() ?? tx.waitForReceipt?.());
      log("✓ executable balance topped up");
      topupOk = true;
    } catch (e) {
      log("⚠️ top-up failed:", e.message);
    }
  }
  if (!topupOk) {
    log("Stopping before init (no executable balance). programId saved to app/.env; rerun after funding wVARA.");
    return;
  }

  // 4. init
  try {
    const settler = addressToActorId(account.address);
    const initPayload = encodeInit(settler, LIVENESS_SECONDS);
    log("init payload", initPayload);
    const tx = await mirror.sendMessage(initPayload, 0n);
    await tx.sendAndWaitForReceipt?.();
    log("✓ init sent");
  } catch (e) {
    log("⚠️ init failed:", e.message);
  }

  // 5. seed pool (optional)
  if (SEED_POOL_ETH > 0n) {
    try {
      const tx = await mirror.sendMessage(encodeCall("SeedPoolEth", [], []), SEED_POOL_ETH);
      await tx.sendAndWaitForReceipt?.();
      log("✓ seeded ETH pool with", SEED_POOL_ETH.toString());
    } catch (e) {
      log("⚠️ seed pool failed:", e.message);
    }
  }

  writeProgramEnv(programId);
  log("DONE. programId =", programId);
}

function writeProgramEnv(programId) {
  const envPath = resolve(root, "app/.env");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const set = (k, v) => {
    env = env.match(new RegExp(`^${k}=.*$`, "m"))
      ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
      : env.trimEnd() + `\n${k}=${v}`;
  };
  set("VITE_ROUTER_ADDRESS", ROUTER);
  set("VITE_PROGRAM_ID", programId);
  set("VITE_WVARA_ADDRESS", WVARA_ADDR);
  writeFileSync(envPath, env.trim() + "\n");
  log("✓ wrote VITE_PROGRAM_ID to app/.env:", programId);
}

main().catch((e) => {
  console.error("[deploy] FAILED:", e);
  process.exit(1);
});
