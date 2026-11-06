// The offer binding. The buyer's signed Hedera transfer carries the offer hash in its memo, so the
// one signature that moves the money also names the offer it pays for.
//   memo = "cs1:" + 64 lowercase hex chars (the offer hash without 0x) = 68 bytes, under Hedera's 100.
import type { Hex } from "viem";

export const MEMO_PREFIX = "cs1:";
const MEMO = /^cs1:([0-9a-f]{64})$/;
const HASH = /^0x[0-9a-f]{64}$/;

export function offerMemo(offerHash: string): string {
  const h = offerHash.toLowerCase();
  if (!HASH.test(h)) throw new Error(`not a 32-byte hex offer hash: ${JSON.stringify(offerHash)}`);
  return MEMO_PREFIX + h.slice(2);
}

/** The offer hash a memo commits to, or null when the memo is not a countersign memo. */
export function offerHashFromMemo(memo: string): Hex | null {
  const m = memo.match(MEMO);
  return m ? (`0x${m[1]}` as Hex) : null;
}
