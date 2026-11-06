import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import catalogue from "../src/fixtures/catalogue.json";
import type { TreeView } from "../src/lib/types.ts";
import { ReceiptTree } from "../src/ui/ReceiptTree.tsx";

// STEER-2235 item 5: a signed branch and the hub's record of a purchase are drawn apart, and never confused.
const fixture = catalogue.tree as unknown as TreeView;
const root = fixture.root;
const [signedA] = fixture.nodes[root]!.slip.body.children;
const observedB = `0x${"b0".repeat(32)}`;
const missingM = `0x${"dd".repeat(32)}`;

function withHubRecord(): TreeView {
  const nodes = structuredClone(fixture.nodes);
  const r = nodes[root]!;
  // The seller signed one more child this hub does not hold, and the hub saw one purchase it did not sign;
  // it also saw a purchase the seller did sign, which must not be drawn twice.
  r.slip.body.children = [...r.slip.body.children, missingM as `0x${string}`];
  r.observed = [observedB, signedA!];
  return { root, nodes, missing: [missingM] };
}

const html = (tree: TreeView) => renderToString(createElement(ReceiptTree, { tree, current: root }));

describe("the receipt tree", () => {
  test("signed children, the hub's record and a missing child are three different rows", () => {
    const out = html(withHubRecord());
    expect(out).toContain("use-arc");
    expect(out).toContain("use-usdc");
    expect(out).toContain("A purchase inside this job");
    expect(out).toContain("The hub&#x27;s record, not signed by the seller");
    expect(out).toContain("Signed into this slip, but not held by this hub");
    expect(out.match(/tree__node--observed/g)).toHaveLength(1);
    expect(out).toContain(`href="#/slip/${observedB}"`);
  });

  test("a purchase both signed and recorded is drawn once, as signed", () => {
    const out = html(withHubRecord());
    expect(out.split(`href="#/slip/${signedA}"`).length - 1).toBe(1);
  });

  test("the legend names the dashed branch only when there is one", () => {
    expect(html(withHubRecord())).toContain("which the seller&#x27;s slip does not sign");
    const plain = html(fixture);
    expect(plain).toContain("Signed into the parent&#x27;s slip");
    expect(plain).not.toContain("which the seller&#x27;s slip does not sign");
    expect(plain).not.toContain("tree__node--observed");
  });
});
