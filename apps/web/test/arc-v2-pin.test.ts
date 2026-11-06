import { describe, expect, test } from "bun:test";
import { jobIdOf, offerHash as hashOf, type Offer, type PaymentRequirements } from "@countersign/core";
import { getAddress } from "viem";
import { ARC_PIN, ARC_PINS, pinFor } from "../src/lib/arc-pin.ts";
import { buildAuthorization, freshTerms, pendingOf, trustedRequirement } from "../src/lib/purchase.ts";
import type { Listing } from "../src/lib/types.ts";

const seller = "0x196768E381490a9849d44bd8427784e9fD3aCd07";
const buyer = "0x8c1f9e2b7d6a5f4e3c2b1a09f8e7d6c5b4a3a20b" as const;
const salt = `0x${"11".repeat(32)}`;
const now = 1_793_980_000;

const v1 = ARC_PINS[0]!;
const v2 = ARC_PINS[1]!;
const UNPINNED = "0x44d11b8909485e3f575F6628b689383E4420f54a";

const WRONG_VERSION = "The hub's terms use an escrow version this page did not pin, so nothing was signed.";
const WRONG_BOND_WINDOW = "The hub's bond or review window is not this offer's, so nothing was signed.";
const NO_TRUST = "The hub's terms name an escrow this page does not trust, so nothing was signed.";

function makeOffer(over: Record<string, unknown> = {}): Offer {
  return {
    v: 1,
    seller,
    title: "use-arc",
    summary: "Answers one question about Arc.",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    bond: "0",
    deadline: 60,
    rails: ["escrow"],
    issuedAt: 1_793_950_000,
    ...over,
  } as unknown as Offer;
}

const offer = makeOffer();
const listing: Listing = { hash: hashOf(offer), offer, seller: { name: "use-arc" }, status: "listed", online: true };

// An offer that declares no bond at all, so v2's fallback must read it as "0".
const unbondedOffer = makeOffer({ bond: undefined });
const unbondedListing: Listing = {
  ...listing,
  hash: hashOf(unbondedOffer),
  offer: unbondedOffer,
};

function requirement(
  over: Partial<PaymentRequirements> = {},
  extra: Record<string, unknown> = {},
  shown: Listing = listing,
): PaymentRequirements {
  return {
    scheme: "countersign",
    network: "eip155:5042002",
    amount: shown.offer.price,
    asset: ARC_PIN.token,
    payTo: shown.offer.seller,
    maxTimeoutSeconds: shown.offer.deadline,
    ...over,
    extra: {
      rail: "escrow",
      escrow: ARC_PIN.escrow,
      chainId: ARC_PIN.chainId,
      offerHash: shown.hash,
      deadlineSeconds: shown.offer.deadline,
      tokenName: ARC_PIN.tokenName,
      tokenVersion: ARC_PIN.tokenVersion,
      ...extra,
    },
  };
}

function v2Requirement(extra: Record<string, unknown> = {}, shown: Listing = listing): PaymentRequirements {
  return requirement(
    {},
    {
      escrow: v2.escrow,
      escrowVersion: 2,
      bond: shown.offer.bond ?? "0",
      reviewWindow: (shown.offer as { reviewWindow?: number }).reviewWindow ?? 0,
      ...extra,
    },
    shown,
  );
}

describe("pinFor", () => {
  test("the v1 address in any letter case gives v1", () => {
    expect(pinFor(ARC_PIN.escrow)?.version).toBe(1);
    expect(pinFor(ARC_PIN.escrow.toUpperCase())?.version).toBe(1);
    expect(pinFor(getAddress(ARC_PIN.escrow))?.version).toBe(1);
  });

  test("the v2 address gives v2", () => {
    expect(pinFor(v2.escrow)?.version).toBe(2);
    expect(pinFor(v2.escrow.toLowerCase())?.version).toBe(2);
  });

  test("a 402 that names no escrow keeps the v1 pin", () => {
    expect(pinFor(undefined)).toBe(v1);
  });

  test("a bad or unpinned address gives null", () => {
    expect(pinFor("0xdead")).toBeNull();
    expect(pinFor(UNPINNED)).toBeNull();
  });
});

describe("trustedRequirement's Arc pins", () => {
  test("a v1 402 is ok with the v1 pin", () => {
    const choice = trustedRequirement([requirement()], listing);
    expect(choice.ok).toBe(true);
    if (!choice.ok) return;
    expect(choice.req).toEqual(requirement());
    expect(choice.pin).toEqual(v1);
  });

  test("a v2 402 is ok with the v2 pin", () => {
    const req = v2Requirement();
    const choice = trustedRequirement([req], listing);
    expect(choice.ok).toBe(true);
    if (!choice.ok) return;
    expect(choice.req).toEqual(req);
    expect(choice.pin).toEqual(v2);
  });

  test("v2 without escrowVersion 2 is refused", () => {
    const req = requirement({}, { escrow: v2.escrow, bond: "0", reviewWindow: 0 });
    expect(trustedRequirement([req], listing)).toEqual({ ok: false, message: WRONG_VERSION });
  });

  test("a v1 pin that meets escrowVersion 2 is refused", () => {
    const req = requirement({}, { escrowVersion: 2 });
    expect(trustedRequirement([req], listing)).toEqual({ ok: false, message: WRONG_VERSION });
  });

  test("v2 with a bond that is not the offer's is refused", () => {
    const req = v2Requirement({ bond: "1" }, unbondedListing);
    expect(trustedRequirement([req], unbondedListing)).toEqual({ ok: false, message: WRONG_BOND_WINDOW });
  });

  test("v2 with a review window that is not the offer's is refused", () => {
    const req = v2Requirement({ reviewWindow: 60 });
    expect(trustedRequirement([req], listing)).toEqual({ ok: false, message: WRONG_BOND_WINDOW });
  });

  test("an unpinned escrow keeps today's refusal", () => {
    const req = requirement({}, { escrow: UNPINNED });
    expect(trustedRequirement([req], listing)).toEqual({ ok: false, message: NO_TRUST });
  });
});

describe("buildAuthorization with the v2 pin", () => {
  const bondedOffer = makeOffer({ bond: "2500", reviewWindow: 120, deadline: 300 });
  const bondedListing: Listing = { ...listing, hash: hashOf(bondedOffer), offer: bondedOffer };

  test("signs the v2 escrow and carries the offer's bond and review window", () => {
    const req = v2Requirement({}, bondedListing);
    const auth = buildAuthorization(req, buyer, now, salt, 0, v2);
    expect(auth.chainId).toBe(v2.chainId);
    expect(auth.escrow).toBe(v2.escrow);
    expect(auth.token).toBe(ARC_PIN.token);
    expect(auth.terms.bond).toBe("2500");
    expect(auth.terms.reviewWindow).toBe(120);
  });

  test("derives a different job id than the same terms under the v1 pin", () => {
    const req = v2Requirement({}, bondedListing);
    const underV2 = buildAuthorization(req, buyer, now, salt, 0, v2);
    const underV1 = buildAuthorization(req, buyer, now, salt, 0, v1);
    expect(jobIdOf(underV2.terms, underV2.chainId, underV2.escrow)).not.toBe(
      jobIdOf(underV1.terms, underV1.chainId, underV1.escrow),
    );
  });
});

describe("freshTerms' pin", () => {
  test("a refetch that returns the other pin gives changed", async () => {
    const req = requirement();
    const old = pendingOf(
      listing,
      { question: "q" },
      req,
      buildAuthorization(req, buyer, now, salt, 0, v1),
      "https://hub.example",
      now,
      v1,
    );

    const result = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: now + 31,
      salt: `0x${"22".repeat(32)}`,
      refetch: async () => ({ req: v2Requirement(), pin: v2 }),
    });

    expect(result.kind).toBe("changed");
    if (result.kind !== "changed") return;
    expect(result.pending.req).toEqual(v2Requirement());
    expect(result.pending.pin).toEqual(v2);
    expect(result.pending.authorization.escrow).toBe(v2.escrow);
    expect(result.pending.authorization.terms.bond).toBe("0");
    expect(result.pending.authorization.terms.reviewWindow).toBe(0);
  });
});
