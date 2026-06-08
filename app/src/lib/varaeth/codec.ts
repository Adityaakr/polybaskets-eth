import { TypeRegistry } from "@polkadot/types";
import { u8aToHex } from "@polkadot/util";
import type { Collateral } from "@/config";

/**
 * SCALE codec for the BasketMarket program's ABI-native `[u8]` blobs.
 *
 * Message envelopes are handled by sails-js (SailsProgram) in client.ts. This module only
 * encodes/decodes the inner aggregates that the contract passes as opaque `[u8]`:
 *   - Vec<BasketItem>  (input to CreateBasket)
 *   - Basket / Vec<Position> / Option<Settlement> / Vec<(Collateral,u128)>  (query returns)
 *
 * The contract stores an Ethereum address as an ActorId left-padded to 32 bytes (confirmed against
 * GetConfig on the live program).
 */

export const COLLATERAL_U16: Record<Collateral, number> = { Eth: 0, Wvara: 1 };
const U16_COLLATERAL: Collateral[] = ["Eth", "Wvara"];

const registry = new TypeRegistry();
registry.register({
  Collateral: { _enum: ["Eth", "Wvara"] },
  Outcome: { _enum: ["Yes", "No"] },
  BasketStatus: { _enum: ["Active", "SettlementPending", "Settled"] },
  SettlementStatus: { _enum: ["Proposed", "Finalized"] },
  BasketItem: { poly_market_id: "Text", poly_slug: "Text", weight_bps: "u16", selected_outcome: "Outcome" },
  Basket: {
    id: "u64", creator: "[u8;32]", name: "Text", description: "Text",
    items: "Vec<BasketItem>", created_at: "u64", status: "BasketStatus",
  },
  Position: {
    basket_id: "u64", user: "[u8;32]", collateral: "Collateral",
    shares: "u128", index_at_creation_bps: "u16", claimed: "bool",
  },
  Settlement: {
    basket_id: "u64", proposer: "[u8;32]", item_resolutions: "Vec<Outcome>",
    index_bps: "u16", proposed_at: "u64", challenge_deadline: "u64",
    finalized_at: "Option<u64>", status: "SettlementStatus",
  },
  Config: { owner: "[u8;32]", settler_role: "[u8;32]", liveness_seconds: "u64" },
});

type Hex = `0x${string}`;

/** 20-byte ETH address -> 32-byte ActorId (left-padded). Matches the contract's storage. */
export function addressToActorId(addr: string): Hex {
  return `0x${addr.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}
/** 32-byte ActorId -> 0x ETH address (last 20 bytes). */
export function actorIdToAddress(actorId: any): Hex {
  const hex = typeof actorId === "string" ? actorId : u8aToHex(actorId);
  return `0x${hex.replace(/^0x/, "").padStart(64, "0").slice(24)}` as Hex;
}

export interface ItemInput {
  poly_market_id: string;
  poly_slug: string;
  weight_bps: number;
  selected_outcome: "Yes" | "No";
}

/** SCALE-encode Vec<BasketItem> into the [u8] blob CreateBasket expects. */
export function encodeBasketItems(items: ItemInput[]): Uint8Array {
  return registry.createType("Vec<BasketItem>", items).toU8a();
}
/** SCALE-encode Vec<Outcome> for ProposeSettlement. */
export function encodeOutcomes(outcomes: ("Yes" | "No")[]): Uint8Array {
  return registry.createType("Vec<Outcome>", outcomes).toU8a();
}

export const decode = {
  basket: (bytes: Uint8Array) => {
    const b: any = registry.createType("Basket", bytes);
    return {
      id: BigInt(b.id.toString()),
      creator: actorIdToAddress(b.creator),
      name: b.name.toString(),
      description: b.description.toString(),
      status: b.status.toString() as "Active" | "SettlementPending" | "Settled",
      created_at: BigInt(b.created_at.toString()),
      items: b.items.map((it: any) => ({
        poly_market_id: it.poly_market_id.toString(),
        poly_slug: it.poly_slug.toString(),
        weight_bps: it.weight_bps.toNumber(),
        selected_outcome: it.selected_outcome.toString() as "Yes" | "No",
      })),
    };
  },
  positions: (bytes: Uint8Array) => {
    const list: any = registry.createType("Vec<Position>", bytes);
    return list.map((p: any) => ({
      basket_id: BigInt(p.basket_id.toString()),
      user: actorIdToAddress(p.user),
      collateral: U16_COLLATERAL[p.collateral.index] ?? "Eth",
      shares: BigInt(p.shares.toString()),
      index_at_creation_bps: p.index_at_creation_bps.toNumber(),
      claimed: p.claimed.isTrue,
    }));
  },
  settlement: (bytes: Uint8Array) => {
    const opt: any = registry.createType("Option<Settlement>", bytes);
    if (opt.isNone) return null;
    const s = opt.unwrap();
    return {
      basket_id: BigInt(s.basket_id.toString()),
      index_bps: s.index_bps.toNumber(),
      challenge_deadline: BigInt(s.challenge_deadline.toString()),
      finalized_at: s.finalized_at.isSome ? BigInt(s.finalized_at.unwrap().toString()) : null,
      status: s.status.toString() as "Proposed" | "Finalized",
    };
  },
  balances: (bytes: Uint8Array): [Collateral, bigint][] => {
    const list: any = registry.createType("Vec<(Collateral, u128)>", bytes);
    return list.map((pair: any) => [U16_COLLATERAL[pair[0].index] ?? "Eth", BigInt(pair[1].toString())]);
  },
};
