import type { Hex } from "viem";
import type { Slip } from "./deps.ts";
import type { Store } from "./store.ts";

/** How far a receipt tree is walked. A cycle cannot grow the response past this. */
const MAX_DEPTH = 8;

export interface TreeNode {
  slip: Slip;
  /** The offer's title, or its hash when the offer is no longer stored. */
  title: string;
  seller: string;
}

/** A root slip and every slip its body.children names, read from the slip store. */
export interface ReceiptTree {
  root: Hex;
  nodes: Record<string, TreeNode>;
}

/**
 * Walk `body.children` from the root slip. Null when that slip is not stored.
 * A child hash the store does not hold is omitted; the caller already has the
 * hash on the parent, so the view can say the slip is missing.
 */
export function receiptTree(store: Store, root: string): ReceiptTree | null {
  const slip = store.getSlip(root);
  if (!slip) return null;

  const nodes: Record<string, TreeNode> = {};
  const seen = new Set<string>();

  const visit = (hash: string, depth: number): void => {
    const key = hash.toLowerCase();
    if (depth > MAX_DEPTH || seen.has(key)) return;
    seen.add(key);
    const found = store.getSlip(hash);
    if (!found) return;
    const offer = store.getOffer(found.body.offerHash);
    nodes[hash] = {
      slip: found,
      title: offer?.offer.title ?? found.body.offerHash,
      seller: found.body.seller,
    };
    for (const child of found.body.children) visit(child, depth + 1);
  };

  visit(slip.hash, 0);
  return { root: slip.hash, nodes };
}
