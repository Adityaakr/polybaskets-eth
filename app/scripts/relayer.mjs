// wVARA bridge relayer for PolyBaskets-ETH.
//   deposits:    watch WvaraVault.Deposited(user, amount) -> program.credit_wvara(user, amount)
//   withdrawals: poll program.GetPendingWvaraWithdrawals -> vault.release(user, amount) + mark_wvara_processed(i)
// Signs with the program owner key (the trusted relayer). Run: node scripts/relayer.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
const appEnv = readFileSync(resolve(root, "app/.env"), "utf8");
const PROGRAM = appEnv.match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const VAULT = env.WVARA_VAULT;
const ETH_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const { ROUTER, VARA_ETH_WS } = env;
const STATE = resolve(root, "deploy/relayer-state.json");
const log = (...a) => console.log("[relayer]", new Date().toISOString().slice(11, 19), ...a);

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const reg = new TypeRegistry();
const toActorId = (addr) => "0x" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const toAddress = (actorId) => "0x" + actorId.replace(/^0x/, "").padStart(64, "0").slice(24);

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

const VAULT_ABI = [
  { type: "event", name: "Deposited", inputs: [
    { name: "user", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }, { name: "nonce", type: "uint256", indexed: false } ] },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
];
const TRANSFER_TOPIC = null;

function loadState() { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { lastNonce: 0, fromBlock: 0 }; }
function saveState(s) { writeFileSync(STATE, JSON.stringify(s)); }

async function programWrite(name, args) {
  // Fire-and-continue: submit the message and confirm the Ethereum tx; the Vara.eth reply
  // commits async (waiting on it can hang), so we don't block the relayer loop on it.
  const payload = svc.functions[name].encodePayload(...args);
  const tx = await mirror.sendMessage(payload, 0n);
  const hash = await tx.send();
  return hash;
}

async function programQueryPending() {
  const payload = svc.queries.GetPendingWvaraWithdrawals.encodePayload();
  const r = await api.call.program.calculateReplyForHandle(account.address, PROGRAM, payload);
  const raw = svc.queries.GetPendingWvaraWithdrawals.decodeResult(r?.payload ?? r?.reply?.payload ?? "0x");
  const bytes = raw?.toU8a ? raw.toU8a(true) : Uint8Array.from(typeof raw === "string" ? raw.replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16)) : raw);
  return reg.createType("Vec<(u32, [u8;32], u128)>", bytes);
}

async function processDeposits(state) {
  const latest = Number(await publicClient.getBlockNumber());
  const from = state.fromBlock || Math.max(0, latest - 5000);
  const logs = await publicClient.getLogs({ address: VAULT, event: VAULT_ABI[0], fromBlock: BigInt(from), toBlock: BigInt(latest) }).catch(() => []);
  for (const l of logs) {
    const nonce = Number(l.args.nonce);
    if (nonce <= state.lastNonce) continue;
    const user = l.args.user; const amount = BigInt(l.args.amount);
    log(`deposit #${nonce}: credit ${amount} wVARA -> ${user}`);
    await programWrite("CreditWvara", [toActorId(user), amount]);
    state.lastNonce = nonce; saveState(state);
    log(`  ✓ credited`);
  }
  state.fromBlock = latest + 1; saveState(state);
}

async function processWithdrawals() {
  const pending = await programQueryPending().catch(() => []);
  for (const entry of pending) {
    const index = entry[0].toNumber(); const to = toAddress(entry[1].toHex()); const amount = BigInt(entry[2].toString());
    log(`withdraw #${index}: release ${amount} wVARA -> ${to}`);
    const hash = await walletClient.writeContract({ address: VAULT, abi: VAULT_ABI, functionName: "release", args: [to, amount], account, chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash });
    await programWrite("MarkWvaraProcessed", [index]);
    log(`  ✓ released + marked`);
  }
}

log("started. program", PROGRAM, "vault", VAULT);
const state = loadState();
for (;;) {
  try { await processDeposits(state); await processWithdrawals(); }
  catch (e) { log("error:", e.message?.slice(0, 120)); }
  await new Promise((r) => setTimeout(r, 6000));
}
