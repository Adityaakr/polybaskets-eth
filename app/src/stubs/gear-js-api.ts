// Stub for @gear-js/api.
//
// `sails-js` declares @gear-js/api as a dependency and its `query-builder.js` imports
// `decodeAddress` from it — but that's the Gear-NODE query path, which this Vara.eth app never
// uses (all reads go through @vara-eth/api `calculateReplyForHandle`; sails-js is used only to
// ENCODE payloads). Aliasing to this stub keeps the build from trying to pull in the entire
// @gear-js/api (+ @polkadot/api node stack), which isn't installed when the app is built in
// isolation (e.g. Railway with root = app/).
//
// `decodeAddress` is a passthrough; it is never reached on any code path we exercise.
export function decodeAddress(address: string | Uint8Array): string {
  return typeof address === "string" ? address : `0x${Buffer.from(address).toString("hex")}`;
}
export function encodeAddress(address: string): string {
  return address;
}
// `sails-js/utils.js` does `new ReplyCode(...)` inside a helper we never call (replies go through
// @vara-eth/api). Minimal class so the named import resolves and construction wouldn't throw.
export class ReplyCode {
  constructor(_bytes?: Uint8Array, _specVersion?: number) {}
  isSuccess() { return true; }
  isError() { return false; }
}
export const GearApi = undefined;
export default {};
