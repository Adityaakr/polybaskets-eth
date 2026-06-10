// Verifies the connected Vara.eth validator's RPC version and which injected-tx wire-shape the
// frontend client (vara-eth-v5 = @vara-eth/api 0.5.x) will send. Use this to diagnose injected-bet
// failures like `RpcError(-32602): Invalid params :: missing field \`data\``, which happens when an
// older client (the legacy { recipient, tx: { data, ... } } shape) talks to an upgraded validator
// that expects the versioned { data, signature, address } shape.
//
// Read-only: connects, negotiates the version, builds (but never SENDS) an injected tx to inspect it.
//
// Usage:  node scripts/verify-version.mjs
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { createVaraEthApi, WsVaraEthProvider } from "vara-eth-v5";
import { walletClientToSigner } from "vara-eth-v5/signer";

const ETH_RPC = process.env.VITE_ETHEREUM_RPC ?? "https://ethereum-hoodi-rpc.publicnode.com";
const WS = process.env.VITE_VARA_ETH_RPC ?? "wss://vara-eth-validator-1.gear-tech.io";
const ROUTER = process.env.VITE_ROUTER_ADDRESS ?? "0xE549b0AfEdA978271FF7E712232B9F7f39A0b060";
const PROGRAM = process.env.VITE_PROGRAM_ID ?? "0xe3bead8473c4cd6fe59f4aee81aa446be271a101";
// Any address — no key, nothing is signed or sent.
const ADDR = (process.argv[2] ?? "0x0000000000000000000000000000000000000001");

const hoodi = defineChain({ id: 560048, name: "Hoodi", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ETH_RPC] } } });
const publicClient = createPublicClient({ chain: hoodi, transport: http(ETH_RPC) });
const walletClient = createWalletClient({ account: ADDR, chain: hoodi, transport: http(ETH_RPC) });

const ws = new WsVaraEthProvider(WS);
await ws.connect();
const api = await createVaraEthApi(ws, publicClient, ROUTER, walletClientToSigner(walletClient));

const version = api.rpcVersion ?? api._rpcVersion ?? null;
console.log(`validator:        ${WS}`);
console.log(`RPC version:      ${JSON.stringify(version)}`);

// Build (do NOT send) an injected tx to inspect the wire-shape it will use.
const itx = await api.createInjectedTransaction({ destination: PROGRAM, payload: "0x00", value: 0n });
const topKeys = Object.keys(itx._rpcData[0]);
const isNew = topKeys.includes("data") && !topKeys.includes("tx") && !topKeys.includes("recipient");
console.log(`injected params:  { ${topKeys.join(", ")} }`);
console.log(`shape:            ${isNew ? "NEW { data, signature, address } — OK" : "OLD { recipient, tx } — validator will reject"}`);

await ws.disconnect?.();
process.exit(isNew ? 0 : 1);
