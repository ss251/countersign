import { describe, expect, test } from "bun:test";
import { offerHash as hashOf, type Offer, type PaymentRequirements } from "@countersign/core";
import { ARC_PIN } from "../src/lib/arc-pin.ts";
import {
  buildAuthorization,
  freshTerms,
  makeOnce,
  pendingOf,
  SIGN_SLACK_SECONDS,
  type PendingPurchase,
} from "../src/lib/purchase.ts";
import type { Listing } from "../src/lib/types.ts";

const buyer = "0x8c1f9e2b7d6a5f4e3c2b1a09f8e7d6c5b4a3a20b" as const;
const seller = "0x196768E381490a9849d44bd8427784e9fD3aCd07" as const;
const thief = "0x000000000000000000000000000000000000dEaD" as const;
const base = "https://hub.example";
const preparedAt = 1_793_980_000;
const salt = `0x${"11".repeat(32)}`;
const nextSalt = `0x${"22".repeat(32)}`;

const offer = {
  v: 1,
  seller,
  title: "use-arc",
  summary: "Answers one question about Arc.",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  bond: "0",
  deadline: 120,
  rails: ["escrow"],
  issuedAt: 1_793_950_000,
} as unknown as Offer;
const offerHash = hashOf(offer);
const listing: Listing = { hash: offerHash, offer, seller: { name: "use-arc" }, status: "listed", online: true };

function requirement(over: Partial<PaymentRequirements> = {}, extra: Record<string, unknown> = {}): PaymentRequirements {
  return {
    scheme: "countersign",
    network: "eip155:5042002",
    amount: "10000",
    asset: ARC_PIN.token,
    payTo: seller,
    maxTimeoutSeconds: 120,
    ...over,
    extra: {
      rail: "escrow",
      escrow: ARC_PIN.escrow,
      chainId: ARC_PIN.chainId,
      offerHash,
      deadlineSeconds: 120,
      tokenName: ARC_PIN.tokenName,
      tokenVersion: ARC_PIN.tokenVersion,
      ...extra,
    },
  };
}

function pending(req: PaymentRequirements = requirement(), when = preparedAt): PendingPurchase {
  return pendingOf(listing, { question: "q" }, req, buildAuthorization(req, buyer, when, salt), base, when);
}

describe("buildAuthorization's sign slack", () => {
  test("adds the wallet's sign time to the deadline, and leaves validBefore alone", () => {
    const auth = buildAuthorization(requirement(), buyer, preparedAt, salt, SIGN_SLACK_SECONDS);
    expect(SIGN_SLACK_SECONDS).toBe(120);
    expect(auth.terms.deadline).toBe(preparedAt + 120 + 120);
    expect(auth.validBefore).toBe(preparedAt + 600);
  });
});

describe("freshTerms", () => {
  test("terms prepared 31 seconds before Sign are refetched and rebuilt at Sign", async () => {
    const old = pending();
    const signNow = preparedAt + 31;
    let calls = 0;

    const result = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: signNow,
      salt: nextSalt,
      refetch: async () => {
        calls += 1;
        return requirement();
      },
    });

    expect(calls).toBe(1);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.pending.authorization.terms.deadline).toBe(signNow + 120 + 120);
    expect(result.pending.jobId).not.toBe(old.jobId);
    expect(result.pending.preparedAt).toBe(signNow);
  });

  test("terms prepared 5 seconds before Sign are not refetched, but are still rebuilt at Sign", async () => {
    const old = pending();
    const signNow = preparedAt + 5;
    let calls = 0;

    const result = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: signNow,
      salt: nextSalt,
      refetch: async () => {
        calls += 1;
        return requirement();
      },
    });

    expect(calls).toBe(0);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.pending.authorization.terms.deadline).toBe(signNow + 240);
    expect(result.pending.jobId).not.toBe(old.jobId);
    expect(result.pending.preparedAt).toBe(signNow);
  });

  test("a refetch whose material terms moved goes back for review", async () => {
    const old = pending();
    const signNow = preparedAt + 31;
    const moved = [
      requirement({ amount: "20000" }),
      requirement({ payTo: thief }),
      requirement({}, { offerHash: `0x${"ab".repeat(32)}` }),
      requirement({}, { deadlineSeconds: 121 }),
      requirement({ network: "eip155:1" }),
      requirement({ asset: "0x000000000000000000000000000000000000dEaD" }),
    ];

    for (const next of moved) {
      const result = await freshTerms({
        pending: old,
        address: buyer,
        nowSeconds: signNow,
        salt: nextSalt,
        refetch: async () => next,
      });
      expect(result.kind).toBe("changed");
      if (result.kind !== "changed") continue;
      expect(result.pending.req).toEqual(next);
      expect(result.pending.preparedAt).toBe(signNow);
    }
  });

  test("a refetch that answers nothing, or throws, signs nothing and says why", async () => {
    const old = pending();
    const signNow = preparedAt + 31;
    const message = "These terms expired, and fresh ones could not be fetched, so nothing was signed.";

    const nothing = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: signNow,
      salt: nextSalt,
      refetch: async () => null,
    });
    expect(nothing).toEqual({ kind: "failed", message });

    const thrown = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: signNow,
      salt: nextSalt,
      refetch: async () => {
        throw new Error("the hub did not answer");
      },
    });
    expect(thrown).toEqual({ kind: "failed", message });
  });

  test("the fresh deadline stays inside the rail's own rule after eight minutes", async () => {
    const old = pending();
    const signNow = preparedAt + 8 * 60;

    const result = await freshTerms({
      pending: old,
      address: buyer,
      nowSeconds: signNow,
      salt: nextSalt,
      refetch: async () => requirement(),
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    const deadline = result.pending.authorization.terms.deadline;
    expect(deadline).toBeGreaterThanOrEqual(signNow + 120 - 15);
    expect(deadline).toBeLessThanOrEqual(signNow + 120 + 300);
  });
});

describe("makeOnce", () => {
  test("a call started while another is in flight does not run the work", async () => {
    let finish = () => {};
    const inFlight = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let calls = 0;
    const once = makeOnce(async () => {
      calls += 1;
      await inFlight;
    });

    const first = once();
    const second = once();
    expect(calls).toBe(1);
    finish();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test("after the work settles, the next call runs it again", async () => {
    let calls = 0;
    const once = makeOnce(async () => {
      calls += 1;
    });

    await once();
    await once();
    expect(calls).toBe(2);
  });

  test("work that throws still releases the guard", async () => {
    let calls = 0;
    const once = makeOnce(async () => {
      calls += 1;
      throw new Error("the wallet did not sign");
    });

    await expect(once()).rejects.toThrow("the wallet did not sign");
    await expect(once()).rejects.toThrow("the wallet did not sign");
    expect(calls).toBe(2);
  });
});
