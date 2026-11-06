import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Slip } from "@countersign/core";
import type { Hex, TreeView } from "../src/lib/types.ts";
import { ReceiptTree } from "../src/ui/ReceiptTree.tsx";

const PARENT = `0x${"a1".repeat(32)}` as Hex;
const CHILD = `0x${"b2".repeat(32)}` as Hex;

function slip(hash: Hex, children: Hex[], amount: string): Slip {
  const seller = `0x${"44".repeat(20)}` as const;
  return {
    body: {
      v: 1,
      rail: "escrow",
      network: "eip155:5042002",
      offerHash: `0x${"11".repeat(32)}`,
      jobId: `0x${"22".repeat(32)}`,
      buyer: `0x${"33".repeat(20)}`,
      seller,
      payTo: seller,
      asset: `0x${"55".repeat(20)}`,
      amount,
      inputHash: `0x${"66".repeat(32)}`,
      outputHash: `0x${"77".repeat(32)}`,
      deliveredAt: 1_700_000_000,
      children,
    },
    hash,
    sellerSig: `0x${"88".repeat(65)}`,
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:5042002",
        amount,
        asset: `0x${"55".repeat(20)}`,
        payTo: seller,
        maxTimeoutSeconds: 60,
      },
      payload: {},
    },
    settlement: { transaction: `0x${"99".repeat(32)}`, network: "eip155:5042002" },
  };
}

const tree: TreeView = {
  root: PARENT,
  nodes: {
    [PARENT]: { slip: slip(PARENT, [CHILD], "20000"), title: "Parent work", sellerName: "Ada" },
    [CHILD]: { slip: slip(CHILD, [], "5000"), title: "Child work", sellerName: "Bea" },
  },
};

describe("receipt tree", () => {
  test("the slip view renders the parent and the slip it bought", () => {
    const html = renderToString(createElement(ReceiptTree, { tree, current: PARENT }));
    expect(html).toContain('aria-label="Receipt tree"');
    expect(html).toContain("Parent work");
    expect(html).toContain("Child work");
    expect(html).toContain("tree__row--current");
    expect(html).toContain(`href="#/slip/${CHILD}"`);
    expect(html).not.toContain(`href="#/slip/${PARENT}"`);
    expect(html).toContain("Ada");
    expect(html).toContain("Bea");
    expect(html).not.toContain("Slip not available");
  });
});
