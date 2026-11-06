import { describe, expect, test } from "bun:test";
import { offerHash as hashOf, type Offer, type PaymentRequirements } from "@countersign/core";
import { ARC_PIN } from "../src/lib/arc-pin.ts";
import type { Listing } from "../src/lib/types.ts";

// The purchase path lives in lib/purchase.ts on cs/ui-A13 (#196); on cs/ui-B it was start/index.tsx.
import { trustedRequirement } from "../src/lib/purchase.ts";

// cs-w1 adversarial test (B24; runs on cs/ui-B). A failing test here is a blocker.
// The start page shows the listing's price and seller, but signs the payee, amount and offer hash
// that its hub's 402 names. "?hub=<url>" on any console link sets and remembers the hub. So a hostile
// link's hub can show a cheap listing, answer the call with any amount payable to itself on the
// pinned escrow, and then, as the job's payee, release it with its own slip. The page must sign only
// the offer it shows, exactly as the buyer agent's checkTerms does: the listing's own hash, its price,
// and its payee (offer.payTo.escrow, else the seller).

const seller = "0x196768E381490a9849d44bd8427784e9fD3aCd07";
const thief = "0x000000000000000000000000000000000000dEaD";

const offer = {
  v: 1,
  seller,
  title: "use-arc",
  summary: "Answers one question about Arc.",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000", // the 0.01 USDC the page shows
  bond: "0",
  deadline: 60,
  rails: ["escrow"],
  issuedAt: 1_793_950_000,
} as unknown as Offer;

const listing: Listing = {
  hash: hashOf(offer),
  offer,
  seller: { name: "use-arc" },
  status: "listed",
  online: true,
};

function requirement(over: Partial<PaymentRequirements> = {}, extra: Record<string, unknown> = {}): PaymentRequirements {
  return {
    scheme: "countersign",
    network: "eip155:5042002",
    amount: "10000",
    asset: ARC_PIN.token,
    payTo: seller,
    maxTimeoutSeconds: 60,
    ...over,
    extra: {
      rail: "escrow",
      escrow: ARC_PIN.escrow,
      chainId: ARC_PIN.chainId,
      offerHash: listing.hash,
      deadlineSeconds: 60,
      tokenName: ARC_PIN.tokenName,
      tokenVersion: ARC_PIN.tokenVersion,
      ...extra,
    },
  };
}

describe("W1 B24: the start page signs only the offer it shows", () => {
  test("the hub's honest terms for the shown listing are still signed", () => {
    expect(trustedRequirement([requirement()], listing).ok).toBe(true);
  });

  test("a 402 asking more than the shown price is refused", () => {
    expect(trustedRequirement([requirement({ amount: "50000000" })], listing).ok).toBe(false);
  });

  test("a 402 paying anyone but the shown offer's payee is refused", () => {
    expect(trustedRequirement([requirement({ payTo: thief })], listing).ok).toBe(false);
  });

  test("a 402 for an offer other than the shown listing is refused", () => {
    expect(trustedRequirement([requirement({}, { offerHash: `0x${"ab".repeat(32)}` })], listing).ok).toBe(false);
  });
});
