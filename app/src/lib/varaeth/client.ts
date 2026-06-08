import { getMirrorClient } from "@vara-eth/api";
import { config, type Collateral } from "@/config";
import { type VaraEthSession } from "./session";
import {
  encodeBasketItems,
  addressToActorId,
  actorIdToAddress,
  COLLATERAL_U16,
  decode as decodeBlob,
  type ItemInput,
} from "./codec";

export type { ItemInput } from "./codec";

const SVC = "BasketMarket";

export interface OnchainBasketItem {
  poly_market_id: string;
  poly_slug: string;
  weight_bps: number;
  selected_outcome: "Yes" | "No";
}
export interface OnchainBasket {
  id: bigint; creator: string; name: string; description: string;
  items: OnchainBasketItem[]; created_at: bigint;
  status: "Active" | "SettlementPending" | "Settled";
}
export interface OnchainPosition {
  basket_id: bigint; user: string; collateral: Collateral;
  shares: bigint; index_at_creation_bps: number; claimed: boolean;
}
export interface OnchainSettlement {
  basket_id: bigint; index_bps: number; challenge_deadline: bigint;
  finalized_at: bigint | null; status: "Proposed" | "Finalized";
}

/**
 * Typed wrapper over the BasketMarket program on Vara.eth.
 * Message envelopes use sails-js (SailsProgram, the real `0x474d…` sails-rs 1.0 encoding).
 * Inner ABI `[u8]` blobs (Vec<BasketItem>, query returns) use ./codec.
 */
export class BasketMarketClient {
  constructor(private session: VaraEthSession) {}

  private fn(name: string) {
    return (this.session.program.services as any)[SVC].functions[name];
  }
  private qry(name: string) {
    return (this.session.program.services as any)[SVC].queries[name];
  }

  // ---- read (free) ----------------------------------------------------------
  private async read(name: string, args: unknown[]) {
    const q = this.qry(name);
    const payload = q.encodePayload(...args);
    const reply = await this.session.api.call.program.calculateReplyForHandle(
      this.session.address, config.programId, payload,
    );
    const raw = (reply as any)?.payload ?? (reply as any)?.reply?.payload ?? "0x";
    return q.decodeResult(raw);
  }

  // ---- injected write (gasless) --------------------------------------------
  private async injected(name: string, args: unknown[]) {
    const f = this.fn(name);
    const payload = f.encodePayload(...args);
    const injected = await this.session.api.createInjectedTransaction({
      destination: config.programId, payload, value: 0n,
    });
    // `send()` signs + submits and returns the validator PRE-CONFIRMATION (~1s): "Accept" when
    // the tx is accepted for inclusion. We don't use sendAndWaitForPromise() — its `...AndWatch`
    // subscription can hang for minutes. The committed state is queryable ~30-60s later; callers
    // that need the effect optimistically proceed on "Accept" and reconcile via polling.
    const status = await injected.send();
    if (typeof status === "string" && /reject|invalid|error/i.test(status)) {
      throw new Error(`Injected ${name} not accepted: ${status}`);
    }
    return { status };
  }

  // ---- classic write with value (deposit / withdraw / seed) ----------------
  private async classic(name: string, args: unknown[], value: bigint) {
    const f = this.fn(name);
    const payload = f.encodePayload(...args);
    const mirror = getMirrorClient(config.programId, this.session.walletClient, this.session.publicClient);
    const tx = await mirror.sendMessage(payload, value);
    // Confirm the Ethereum tx (~1 block) and return — DON'T block on the Vara.eth reply, which
    // commits asynchronously and can hang for minutes. Callers poll the ledger for the effect.
    const hash = await tx.send();
    try { await this.session.publicClient.waitForTransactionReceipt({ hash }); } catch { /* best effort */ }
    return { hash };
  }

  // ============================ Public API ==================================
  // gameplay (injected, zero value)
  /**
   * Submit CreateBasket (gasless injected). Returns the new basket id the instant the tx is
   * PRE-CONFIRMED (~1s) — the new id is the basket count at submit time. The committed state is
   * queryable ~30-60s later; the basket page shows a "confirming" state until then.
   */
  async createBasket(
    name: string, description: string, items: ItemInput[],
  ): Promise<bigint | undefined> {
    const blob = Array.from(encodeBasketItems(items));
    const before = await this.getBasketCount();
    await this.injected("CreateBasket", [name, description, blob]); // pre-confirmed in ~1s
    return before; // optimistic id = count before creation
  }
  bet(basketId: bigint, collateral: Collateral, amount: bigint, indexBps: number) {
    return this.injected("BetOnBasket", [basketId, COLLATERAL_U16[collateral], amount, indexBps]);
  }
  claim(basketId: bigint) {
    return this.injected("Claim", [basketId]);
  }

  /**
   * Create a basket AND bet on it, reliably. The bet can't reference the basket until it has
   * COMMITTED (otherwise `BetOnBasket` silently reverts as BasketNotFound/NotActive — the race
   * that lost wVARA bets). So: submit CreateBasket → wait for the real committed basket (matched
   * by creator + name, not an optimistic id) → then submit the bet on its real id.
   * `onProgress` reports the phase for UI.
   */
  async createAndBet(
    name: string, description: string, items: ItemInput[],
    collateral: Collateral, amount: bigint, indexBps: number,
    onProgress?: (msg: string) => void,
  ): Promise<bigint> {
    const sym = collateral === "Eth" ? "ETH" : "wVARA";

    // Pre-flight: the pre-confirmation "Accept"s a bet even when it would revert on-chain (e.g.
    // insufficient deposited balance), which would silently orphan the basket with no position.
    // So verify the real on-chain ledger balance BEFORE submitting.
    const bal = await this.getBalance(this.session.address, collateral).catch(() => 0n);
    if (bal < amount) {
      throw new Error(`Not enough deposited ${sym} to cover this bet — deposit more first.`);
    }

    const blob = Array.from(encodeBasketItems(items));
    // The new basket's id is the current count. Submit CreateBasket then BetOnBasket back-to-back:
    // both are PRE-CONFIRMED (~1s each) and the validator chains them on the evolving pre-confirmed
    // state, so the bet lands on the just-created basket — no waiting for the ~30-60s L1 commit.
    // (Verified on-chain: create+bet in ~2s, ledger debited.) Committed state shows shortly after.
    const before = await this.getBasketCount();
    onProgress?.("Signing your slip…");
    await this.injected("CreateBasket", [name, description, blob]); // pre-confirmed ~1s
    await this.bet(before, collateral, amount, indexBps); // pre-confirmed ~1s, chains on the create
    return before;
  }

  // value movement
  depositEth(valueWei: bigint) {
    return this.classic("DepositEth", [], valueWei); // ETH carries value → classic
  }
  /**
   * wVARA deposit → approve the vault, then `vault.deposit(amount)` pulls REAL wVARA on Hoodi.
   * The relayer mirrors it into the program ledger (credit_wvara) so it's backed 1:1.
   */
  async depositWvara(amount: bigint): Promise<{ hash: `0x${string}` }> {
    await this.erc20Approve(config.wvaraAddress, config.wvaraVault, amount);
    const VAULT = [{
      type: "function", name: "deposit", stateMutability: "nonpayable",
      inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }],
    }] as const;
    const hash = await this.session.walletClient.writeContract({
      address: config.wvaraVault, abi: VAULT, functionName: "deposit", args: [amount],
      account: this.session.address, chain: undefined,
    } as any);
    await this.session.publicClient.waitForTransactionReceipt({ hash });
    return { hash };
  }
  // withdrawals: ETH egress via classic; wVARA queues a vault release (injected, pre-confirmed)
  withdrawEth(amount: bigint) { return this.classic("WithdrawEth", [amount], 0n); }
  withdrawWvara(amount: bigint) { return this.injected("WithdrawWvara", [amount]); }

  /** ERC-20 approve helper. */
  private async erc20Approve(token: `0x${string}`, spender: `0x${string}`, amount: bigint) {
    const ERC20 = [{
      type: "function", name: "approve", stateMutability: "nonpayable",
      inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }],
    }] as const;
    const hash = await this.session.walletClient.writeContract({
      address: token, abi: ERC20, functionName: "approve", args: [spender, amount],
      account: this.session.address, chain: undefined,
    } as any);
    await this.session.publicClient.waitForTransactionReceipt({ hash });
  }
  seedPoolEth(valueWei: bigint) { return this.classic("SeedPoolEth", [], valueWei); }
  seedPoolWvara(amount: bigint) { return this.classic("SeedPoolWvara", [amount], 0n); }

  // reads
  async getBasketCount(): Promise<bigint> {
    return BigInt((await this.read("GetBasketCount", [])).toString());
  }
  async getBasket(id: bigint): Promise<OnchainBasket> {
    return decodeBlob.basket(unwrapBytes(await this.read("GetBasket", [id]))) as OnchainBasket;
  }
  /** Fetch every basket [0, count). Robust: skips any that fail to decode (e.g. not yet committed). */
  async getAllBaskets(): Promise<OnchainBasket[]> {
    const count = Number(await this.getBasketCount());
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.getBasket(BigInt(i)).catch(() => null),
      ),
    );
    return results.filter((b): b is OnchainBasket => b != null);
  }
  async getPositions(user: `0x${string}`): Promise<OnchainPosition[]> {
    return decodeBlob.positions(unwrapBytes(await this.read("GetPositions", [addressToActorId(user)]))) as OnchainPosition[];
  }
  async getSettlement(basketId: bigint): Promise<OnchainSettlement | null> {
    return decodeBlob.settlement(unwrapBytes(await this.read("GetSettlement", [basketId]))) as OnchainSettlement | null;
  }
  async getBalance(user: `0x${string}`, c: Collateral): Promise<bigint> {
    const r: any = await this.read("GetBalance", [addressToActorId(user), COLLATERAL_U16[c]]);
    return BigInt((r?.ok ?? r).toString());
  }
  async getBalances(user: `0x${string}`): Promise<[Collateral, bigint][]> {
    return decodeBlob.balances(unwrapBytes(await this.read("GetBalances", [addressToActorId(user)])));
  }
  async getPool(c: Collateral): Promise<bigint> {
    const r: any = await this.read("GetPool", [COLLATERAL_U16[c]]);
    return BigInt((r?.ok ?? r).toString());
  }
}

export { actorIdToAddress };

/** sails-js decodeResult of a `[u8]` (possibly `Result<[u8],Error>`) → raw Uint8Array. */
function unwrapBytes(decoded: any): Uint8Array {
  const v = decoded?.ok ?? decoded;
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string" && v.startsWith("0x")) {
    return Uint8Array.from(v.slice(2).match(/../g)?.map((b: string) => parseInt(b, 16)) ?? []);
  }
  if (v?.toU8a) return v.toU8a(true);
  return new Uint8Array();
}
