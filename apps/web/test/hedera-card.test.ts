import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { listingByTitle } from "../src/fixtures/index.ts";
import type { HederaPurchase } from "../src/lib/hedera.ts";
import type { Listing } from "../src/lib/types.ts";
import type { HederaBuyState } from "../src/routes/assistant/Assistant.tsx";

// The card imports NeedsSignature, which asks the router what it has; the test is not the app.
mock.module(new URL("../src/app/routes.ts", import.meta.url).pathname, () => ({ hasRoute: () => false, VIEWS: [] }));
const { HederaAction, hederaActionShown } = await import("../src/routes/assistant/Assistant.tsx");

const account = { accountId: "0.0.9185802", usdc: "0.50" };

const withHedera = (): Listing => {
  const listing = listingByTitle("hedera-agent-kit")!;
  return { ...listing, offer: { ...listing.offer, rails: ["hedera-scheduled", "hedera"] } };
};

const paid: HederaPurchase = {
  steps: [
    { label: "Payment signed by your Hedera wallet", at: "2026-11-07T10:00:00.000Z" },
    { label: "Seller delivered", at: "2026-11-07T10:00:02.000Z" },
    { label: "Output checked", at: "2026-11-07T10:00:02.500Z" },
    { label: "Settled on Hedera", at: "2026-11-07T10:00:05.000Z", url: "https://hashscan.io/testnet/transaction/0.0.1@1.2" },
    { label: "Slip minted", at: "2026-11-07T10:00:05.500Z", url: "/verify?slip=0xabc" },
  ],
  slipHash: "0xabc",
  hashscanUrl: "https://hashscan.io/testnet/transaction/0.0.1@1.2",
  output: { guidance: "Use the scheduled transfer." },
};

function card(state: HederaBuyState, listing: Listing = withHedera(), accountOrNull: typeof account | null = account): string {
  return renderToString(createElement(HederaAction, { listing, account: accountOrNull, state, onPay: () => {} }));
}

const plain = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("the purchase card's Hedera action", () => {
  test("an offer on the hedera rail, signed in with an account, offers the hold", () => {
    const html = card({ kind: "idle" });
    expect(html).toContain("Hold to pay on Hedera");
    expect(html).toContain("0.01 USDC");
  });

  test("an offer without hedera shows no Hedera action, even with an account", () => {
    const listing = listingByTitle("use-arc")!;
    expect(hederaActionShown(listing.offer.rails, account)).toBe(false);
    expect(card({ kind: "idle" }, listing)).toBe("");
  });

  test("no account, no action: the console waits until the hub names one", () => {
    expect(card({ kind: "idle" }, withHedera(), null)).toBe("");
  });

  test("while the buy runs, one plain line says so and the hold waits", () => {
    const html = card({ kind: "paying" });
    expect(html).toContain("Paying on Hedera. The seller is working; this takes a few seconds on testnet.");
    expect(html).toContain('aria-disabled="true"');
  });

  test("the hub's 200 renders its five steps in order, each with its time and link", () => {
    const html = plain(card({ kind: "paid", purchase: paid }));
    const labels = paid.steps.map((step) => step.label);
    const at = labels.map((label) => html.indexOf(label));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('href="https://hashscan.io/testnet/transaction/0.0.1@1.2"');
    expect(html).toContain("#/verify?slip=0xabc");
    expect(html).toContain("Use the scheduled transfer.");
    expect(html).toContain("Paid on Hedera");
  });

  test("the hub's error message is shown exactly, as it arrived", () => {
    const message = "Refused. This would spend 0.50 USDC, but your account holds 0.10 USDC.";
    const html = plain(card({ kind: "failed", message }));
    expect(html).toContain(message);
  });
});
