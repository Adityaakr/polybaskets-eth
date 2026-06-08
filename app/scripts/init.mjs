// Send the Init constructor message to the deployed program and capture the reply.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EthereumClient, getMirrorClient } from "@vara-eth/api";
import { SailsProgram } from "sails-js";
import { SailsIdlParser } from "sails-js/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const l of readFileSync(resolve(root, "deploy/.env.deploy"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !l.trim().startsWith("#")) env[m[1]] = m[2];
}
const PROGRAM = readFileSync(resolve(root, "app/.env"), "utf8").match(/^VITE_PROGRAM_ID=(0x[0-9a-fA-F]+)/m)[1];
const { ROUTER, ETHEREUM_RPC } = env;
const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETHEREUM_RPC] } } });

const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const actorId = "0x" + account.address.slice(2).toLowerCase().padStart(64, "0");
const parser = new SailsIdlParser();
await parser.init();
const program = new SailsProgram(parser.parse(readFileSync(resolve(root, "app/public/basket_market.idl"), "utf8")));
const initPayload = program.ctors.Init.encodePayload(actorId, 720);

const publicClient = createPublicClient({ chain: hoodi, transport: http(ETHEREUM_RPC) });
const walletClient = createWalletClient({ account, chain: hoodi, transport: http(ETHEREUM_RPC) });
const eth = new EthereumClient(publicClient, walletClient, ROUTER);
await eth.isInitialized;
const mirror = getMirrorClient(PROGRAM, walletClient, publicClient);

console.log("[init] program", PROGRAM);
console.log("[init] payload", initPayload);
const tx = await mirror.sendMessage(initPayload, 0n);
const hash = await tx.send();
console.log("[init] tx hash", hash, "— waiting for reply…");
const { waitForReply } = await tx.setupReplyListener();
const reply = await waitForReply();
console.log("[init] replyCode:", reply.replyCode, "(0x00000000/0x00010000 = success)");
console.log("[init] reply payload:", reply.payload);
const ascii = Buffer.from((reply.payload || "0x").slice(2), "hex").toString("utf8").replace(/[^\x20-\x7e]/g, ".");
console.log("[init] reply as text:", ascii);
process.exit(0);
