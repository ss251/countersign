import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { Slip } from "@countersign/core";
import type { RailDeclaration, Settlement } from "../src/lib/types.ts";
import { heldBy } from "../src/routes/home/field.ts";
import { JourneyStage, type JourneyProps } from "../src/routes/home/Journey.tsx";

// A released escrow payment as the hub serves it; no slip is read without the hub.
const RELEASE: Settlement = {
  jobId: `0x${"11".repeat(32)}`,
  offerHash: `0x${"22".repeat(32)}`,
  title: "A signed market brief",
  seller: `0x${"33".repeat(20)}`,
  buyer: `0x${"44".repeat(20)}`,
  amount: "250000",
  rail: "escrow",
  network: "eip155:5042002",
  kind: "released",
  tx: `0x${"55".repeat(32)}`,
  slipHash: `0x${"66".repeat(32)}`,
  at: 1_793_960_000,
};

const RAILS = [{ id: "escrow", escrow: `0x${"77".repeat(20)}` } as RailDeclaration];

const STATEMENTS = [
  "Every purchase has five parties.",
  "The agent signs its limits once.",
  "Above them, you countersign the exact offer and amount.",
  "The money is held until the work lands.",
  "The seller delivers, signs, and the slip verifies.",
];

type Props = Omit<JourneyProps, "envelope"> & { envelope?: JourneyProps["envelope"] };
const html = (props: Props): string => renderToString(createElement(JourneyStage, { envelope: undefined, ...props }));
const DATA = /journey__data/g;

describe("the journey follows one payment", () => {
  test("pinned, one release carries all five statements in order, and its record on the cards", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: false, pinned: true, narrow: false });
    let at = -1;
    for (const words of STATEMENTS) {
      const i = out.indexOf(words);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    // The example envelope, then the countersignature, the hold and the release: four cards of data.
    expect(out.match(DATA)).toHaveLength(4);
    expect(out).toContain("A signed market brief");
  });

  test("a hub that did not answer says so on every payment card, even with a stale release", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: true, pinned: true, narrow: false });
    expect(out.match(/The hub did not answer/g)).toHaveLength(3);
    expect(out.match(DATA)).toHaveLength(1);
    expect(out).not.toContain("A signed market brief");
  });

  test("no escrow release yet says so plainly, with no payment data and no fixtures", () => {
    const out = html({ release: undefined, rails: RAILS, hubDown: false, pinned: true, narrow: false });
    expect(out.match(/No escrow payment has cleared on this hub yet/g)).toHaveLength(3);
    expect(out.match(DATA)).toHaveLength(1);
  });

  test("less motion gives five static sections, each with its own diagram and no exit", () => {
    const out = html({ release: RELEASE, rails: RAILS, hubDown: false, pinned: false, narrow: false });
    const beats = [...out.matchAll(/data-beat="(\d+)"/g)].map((m) => m[1]);
    expect(beats).toEqual(["0", "1", "2", "3", "4"]);
    expect(out.match(/class="diagram"/g)).toHaveLength(5);
    for (const words of STATEMENTS) expect(out).toContain(words);
  });
});

// Production's five rails on 06 Nov, as /rails declares them (only the fields the landing reads).
const PROD_RAILS = [
  { id: "escrow", network: "eip155:5042002", kind: "escrow", escrow: "0x19c27D770969291E6A0a305dc1Be1a845E7c1b76", explorerTx: "https://explorer.testnet.arc.io/tx/{tx}" },
  { id: "whitechain", network: "eip155:1874", kind: "escrow", escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4", explorerTx: "https://explorer.testnet.whitechain.io/tx/{tx}" },
  { id: "gateway", network: "eip155:5042002", kind: "batched", explorerTx: "" },
  { id: "hedera", network: "hedera:testnet", kind: "direct", explorerTx: "https://hashscan.io/testnet/transaction/{tx}" },
  { id: "hedera-scheduled", network: "hedera:testnet", kind: "escrow", explorerTx: "https://hashscan.io/testnet/transaction/{tx}" },
] as unknown as RailDeclaration[];

// A Whitechain release as production serves it (firstmate FAIL 16:07Z; cs-wc's ask 16:07:54Z).
const WHITECHAIN: Settlement = {
  ...RELEASE,
  rail: "whitechain",
  network: "eip155:1874",
  amount: "10000",
  tx: `0x${"88".repeat(32)}`,
  explorer: `https://explorer.testnet.whitechain.io/tx/0x${"88".repeat(32)}`,
};

describe("each step renders from the payment's own records", () => {
  test("a Whitechain release names Whitechain's escrow and chain, and never Arc's", () => {
    const out = html({ release: WHITECHAIN, rails: PROD_RAILS, hubDown: false, pinned: false, narrow: false });
    expect(out).toContain("Held on Whitechain Sepolia by the escrow contract until the output checks out.");
    expect(out).toContain("https://explorer.testnet.whitechain.io/address/0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4");
    expect(out).toContain(`https://explorer.testnet.whitechain.io/tx/0x${"88".repeat(32)}`);
    expect(out.toLowerCase()).not.toContain("0x19c27d77");
    expect(out).not.toContain("Arc testnet");
    expect(out).not.toContain("arcscan");
  });

  test("an Arc release names Arc's escrow on Arc's explorer", () => {
    const own = heldBy({ ...RELEASE, explorer: null }, PROD_RAILS, undefined);
    expect(own.escrow).toBe("0x19c27D770969291E6A0a305dc1Be1a845E7c1b76");
    expect(own.chain).toBe("Arc testnet");
    expect(own.escrowHref).toBe("https://explorer.testnet.arc.io/address/0x19c27D770969291E6A0a305dc1Be1a845E7c1b76");
    expect(own.txHref).toBe(`https://explorer.testnet.arc.io/tx/${RELEASE.tx}`);
  });

  test("the seller's slip names the escrow that held it, over the rail's current contract", () => {
    const v2 = `0x${"ab".repeat(20)}`;
    const slip = { body: { escrow: v2 } } as unknown as Slip;
    expect(heldBy(WHITECHAIN, PROD_RAILS, slip).escrow).toBe(v2);
  });

  test("a record that names no escrow leaves the escrow out rather than borrow another rail's", () => {
    const held: Settlement = { ...RELEASE, rail: "hedera-scheduled", network: "hedera:testnet", tx: "0.0.11337064@1793979688.938046614" };
    const own = heldBy(held, PROD_RAILS, undefined);
    expect(own.escrow).toBeUndefined();
    expect(own.chain).toBe("Hedera testnet");
  });
});
