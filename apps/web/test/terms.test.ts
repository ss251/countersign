import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { JsonSchema } from "@countersign/core";
import type { RailDeclaration } from "../src/lib/types.ts";
import { deadlineWords, failedDeliveryNote, termsKind } from "../src/lib/terms.ts";
import { RailCard } from "../src/ui/RailCard.tsx";
import { OfferTerms } from "../src/routes/offer/OfferTerms.tsx";
import { curlCommand } from "../src/routes/offer/index.tsx";

const USDC = (network: RailDeclaration["network"]): RailDeclaration["asset"] => ({
  network,
  address: "0x3600000000000000000000000000000000000000",
  symbol: "USDC",
  decimals: 6,
});

const ESCROW: RailDeclaration = {
  id: "escrow",
  network: "eip155:5042002",
  scheme: "countersign",
  asset: USDC("eip155:5042002"),
  kind: "escrow",
  escrow: "0x19c27D770969291E6A0a305dc1Be1a845E7c1b76",
  gasPaidBy: "hub",
  finality: "One Arc block after release.",
  explorerTx: "https://testnet.arcscan.app/tx/{tx}",
};

const GATEWAY: RailDeclaration = {
  id: "gateway",
  network: "eip155:5042002",
  scheme: "exact",
  asset: USDC("eip155:5042002"),
  kind: "batched",
  gasPaidBy: "gateway",
  finality: "The buyer's Gateway balance is debited at once; Circle Gateway credits the seller in its next batch.",
  explorerTx: "https://testnet.arcscan.app/tx/{tx}",
};

const HEDERA: RailDeclaration = {
  id: "hedera",
  network: "hedera:testnet",
  scheme: "exact",
  asset: USDC("hedera:testnet"),
  kind: "direct",
  gasPaidBy: "facilitator",
  finality: "Final at Hedera consensus, a few seconds after the facilitator submits.",
  explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
};

const HEDERA_SCHEDULED: RailDeclaration = {
  id: "hedera-scheduled",
  network: "hedera:testnet",
  scheme: "exact",
  asset: USDC("hedera:testnet"),
  kind: "escrow",
  gasPaidBy: "facilitator",
  finality: "Final at Hedera consensus, a few seconds after the facilitator submits.",
  explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
};

const render = (rails: RailDeclaration["id"][], declarations: RailDeclaration[], deadline = 120): string =>
  renderToString(createElement(OfferTerms, { rails, declarations, deadline }));

/** React escapes apostrophes in server HTML; the words themselves are what matter. */
const plain = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("termsKind", () => {
  test("a declared escrow contract is escrow; an escrow kind with none is held", () => {
    expect(termsKind(ESCROW)).toBe("escrow");
    expect(termsKind(HEDERA_SCHEDULED)).toBe("held");
    expect(termsKind(HEDERA)).toBe("direct");
    expect(termsKind(GATEWAY)).toBe("batched");
  });
});

describe("the offer's terms come from each rail's own declaration", () => {
  test("gateway and hedera promise no escrow, refund or release gate", () => {
    const html = render(["gateway", "hedera"], [GATEWAY, HEDERA]);
    expect(html).not.toMatch(/escrow|refund|released only|until the output checks out/i);
  });

  test("the escrow rail shows its refund window and release gate", () => {
    const html = render(["escrow"], [ESCROW]);
    expect(html).toContain("Refund window");
    expect(html).toContain("until the output checks out");
  });

  test("the held schedule says the seller's key can release it, and never says refund", () => {
    const html = render(["hedera-scheduled"], [HEDERA_SCHEDULED]);
    expect(plain(html)).toContain("The seller's key alone can also release it without delivering");
    expect(html).not.toMatch(/refund/i);
  });
});

describe("failed delivery and deadline words", () => {
  test("only an all-escrow offer promises the money back", () => {
    expect(failedDeliveryNote(["escrow"])).toContain("the money goes back");
    expect(failedDeliveryNote(["batched", "direct"])).not.toContain("the money goes back");
  });

  test("a rail that pays first never promises a refund", () => {
    expect(deadlineWords("direct", 120)).toContain("no refund");
    expect(deadlineWords("escrow", 120)).toContain("anyone can refund");
  });
});

describe("curlCommand", () => {
  test("sends the input object the hub reads", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string" } },
    };
    const command = curlCommand(`0x${"11".repeat(32)}`, schema, "https://hub.example");
    const match = command.match(/-d '(.*)'$/);
    expect(match).not.toBeNull();
    const body = JSON.parse(match![1]!) as unknown;
    expect(body).toHaveProperty("input");
  });
});

describe("RailCard", () => {
  test("the held declaration says Held, not escrow's release-or-refund line", () => {
    const html = renderToString(createElement(RailCard, { declaration: HEDERA_SCHEDULED }));
    expect(html).toContain("Held.");
    expect(html).not.toContain("until release or refund");
  });
});
