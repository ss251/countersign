import { describe, expect, test } from "bun:test";
import type { Offer, PaymentPayload, PaymentRequirements } from "@countersign/core";
import { Challenge, Credential, PaymentRequest, type Receipt } from "mppx";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, type Log } from "viem";
import { TEMPO_CURRENCY } from "../constants.ts";
import {
  createMppRail,
  payerFromReceipt,
  type MppRailOptions,
  type SettledStore,
} from "../rail.ts";

const SECRET = "s".repeat(32);
const REALM = "localhost";
const RESOURCE = "http://localhost:8798/paid";
const SELLER = "0x1111111111111111111111111111111111111111" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000aa" as const;
const OTHER_RECIPIENT = "0x00000000000000000000000000000000000000bb" as const;
const PAYER = "0x00000000000000000000000000000000000000ab" as const;
const OTHER_PAYER = "0x00000000000000000000000000000000000000cd" as const;
const OTHER_TOKEN = "0x00000000000000000000000000000000000000ee" as const;
const TX_HASH = `0x${"cd".repeat(32)}` as const;
const RECEIPT_HASH = `0x${"ab".repeat(32)}` as const;

const offer: Offer = {
  v: 1,
  seller: SELLER,
  title: "Replay test offer",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  deadline: 3600,
  bond: "0",
  rails: ["mpp"],
  payTo: { mpp: RECIPIENT },
  issuedAt: 1_793_957_000,
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function memorySettled(): SettledStore {
  const ids = new Set<string>();
  return {
    has: (id) => ids.has(id),
    claim: (id) => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
    release: (id) => {
      ids.delete(id);
    },
  };
}

function railWith(over: Partial<MppRailOptions> = {}) {
  return createMppRail({ secretKey: SECRET, realm: REALM, ...over });
}

function tempoChallenge(requirements: PaymentRequirements) {
  const mpp = requirements.extra?.mpp as { wwwAuthenticate: string };
  const found = Challenge.deserializeList(mpp.wwwAuthenticate).find((c) => c.method === "tempo");
  if (!found) throw new Error("no tempo challenge");
  return found;
}

function nonceOf(challenge: ReturnType<typeof Challenge.deserialize>): string {
  const meta = challenge.meta ?? (challenge.opaque ? PaymentRequest.deserialize(challenge.opaque) : undefined);
  if (typeof meta !== "object" || meta === null) throw new Error("no challenge meta");
  const nonce = (meta as Record<string, unknown>).nonce;
  if (typeof nonce !== "string") throw new Error("no challenge nonce");
  return nonce;
}

function pushPayment(requirements: PaymentRequirements, txHash: string): PaymentPayload {
  const credential = Credential.serialize(
    Credential.from({ challenge: tempoChallenge(requirements), payload: { type: "hash", hash: txHash } }),
  );
  return { x402Version: 2, accepted: requirements, payload: { credential }, resource: { url: RESOURCE } };
}

function paymentFor(requirements: PaymentRequirements, credential: string): PaymentPayload {
  return { x402Version: 2, accepted: requirements, payload: { credential }, resource: { url: RESOURCE } };
}

function tempoMppx(
  broadcastCredential: (credential: string) => Promise<Receipt.Receipt>,
): NonNullable<MppRailOptions["tempoMppx"]> {
  return { validateCredential: async () => {}, broadcastCredential };
}

function receipt(reference: string): Receipt.Receipt {
  return {
    method: "tempo",
    reference,
    status: "success" as const,
    timestamp: new Date().toISOString(),
  };
}

function transferLog(token: string, from: string, to: string, value: bigint, logIndex: number): Log {
  return {
    address: token as `0x${string}`,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: from as `0x${string}`, to: to as `0x${string}` },
    }) as Log["topics"],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockHash: `0x${"00".repeat(32)}`,
    blockNumber: 1n,
    logIndex,
    removed: false,
    transactionHash: `0x${"00".repeat(32)}`,
    transactionIndex: 0,
  };
}

describe("nonce", () => {
  test("issues a different challenge id and nonce for every issuance in one second", () => {
    const rail = railWith();
    const now = nowSeconds();
    const first = tempoChallenge(rail.challenge(offer, { resource: RESOURCE, now }));
    const second = tempoChallenge(rail.challenge(offer, { resource: RESOURCE, now }));

    expect(first.id).not.toBe(second.id);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(nonceOf(first)).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceOf(second)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("refuses a credential whose challenge nonce was changed", async () => {
    const rail = railWith({ tempoMppx: tempoMppx(async () => receipt(RECEIPT_HASH)) });
    const requirements = rail.challenge(offer, { resource: RESOURCE, now: nowSeconds() });
    const challenge = tempoChallenge(requirements);
    const tampered = {
      ...challenge,
      opaque: PaymentRequest.serialize({ nonce: "f".repeat(32) }),
    };
    const credential = Credential.serialize(
      Credential.from({ challenge: tampered, payload: { type: "hash", hash: TX_HASH } }),
    );

    expect(await rail.verify(paymentFor(requirements, credential), requirements)).toEqual({
      isValid: false,
      invalidReason: "challenge_not_ours",
    });
    const settled = await rail.settle(paymentFor(requirements, credential), requirements);
    expect(settled.success).toBe(false);
    expect(settled.errorReason).toBe("challenge_not_ours");
  });
});

describe("replay", () => {
  test("refuses the same transfer under a second challenge", async () => {
    let broadcasts = 0;
    const rail = railWith({
      seen: memorySettled(),
      tempoMppx: tempoMppx(async () => {
        broadcasts += 1;
        return receipt(RECEIPT_HASH);
      }),
      payerOf: async () => undefined,
    });
    const now = nowSeconds();
    const forA = rail.challenge(offer, { resource: RESOURCE, now });
    const forB = rail.challenge(offer, { resource: RESOURCE, now });
    expect(tempoChallenge(forA).id).not.toBe(tempoChallenge(forB).id);

    const first = await rail.settle(pushPayment(forA, TX_HASH), forA);
    expect(first.success).toBe(true);

    const secondPayment = pushPayment(forB, TX_HASH);
    expect(await rail.verify(secondPayment, forB)).toEqual({ isValid: false, invalidReason: "replay" });
    const second = await rail.settle(secondPayment, forB);
    expect(second.success).toBe(false);
    expect(second.errorReason).toBe("replay");
    expect(broadcasts).toBe(1);
  });

  test("releases both claims when the broadcast fails, so the retry settles", async () => {
    let calls = 0;
    const rail = railWith({
      seen: memorySettled(),
      tempoMppx: tempoMppx(async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient broadcast failure");
        return receipt(RECEIPT_HASH);
      }),
      payerOf: async () => undefined,
    });
    const requirements = rail.challenge(offer, { resource: RESOURCE, now: nowSeconds() });
    const payment = pushPayment(requirements, TX_HASH);

    const first = await rail.settle(payment, requirements);
    expect(first.success).toBe(false);
    expect(first.errorReason).toBe("payment_failed");

    expect(await rail.verify(payment, requirements)).toEqual({ isValid: true });
    const second = await rail.settle(payment, requirements);
    expect(second.success).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("payer", () => {
  test("reports the payer read from the chain on settle and none from verify", async () => {
    const calls: Array<{ txHash: string; recipient: string; amount: bigint }> = [];
    const rail = railWith({
      tempoMppx: tempoMppx(async () => receipt(TX_HASH)),
      payerOf: async (txHash, expect) => {
        calls.push({ txHash, recipient: expect.recipient, amount: expect.amount });
        return PAYER;
      },
    });
    const requirements = rail.challenge(offer, { resource: RESOURCE, now: nowSeconds() });
    const payment = pushPayment(requirements, TX_HASH);

    expect(await rail.verify(payment, requirements)).toEqual({ isValid: true });
    const settled = await rail.settle(payment, requirements);
    expect(settled.success).toBe(true);
    expect(settled.payer).toBe(PAYER);
    expect(calls).toEqual([{ txHash: TX_HASH, recipient: RECIPIENT, amount: 10_000n }]);
  });

  test("reports no payer when the chain lookup finds none", async () => {
    const rail = railWith({
      tempoMppx: tempoMppx(async () => receipt(TX_HASH)),
      payerOf: async () => undefined,
    });
    const requirements = rail.challenge(offer, { resource: RESOURCE, now: nowSeconds() });

    const settled = await rail.settle(pushPayment(requirements, TX_HASH), requirements);
    expect(settled.success).toBe(true);
    expect(settled).not.toHaveProperty("payer");
  });

  test("payerFromReceipt returns the sender of the matching Transfer only", () => {
    const amount = 10_000n;
    const logs = [
      transferLog(OTHER_TOKEN, OTHER_PAYER, RECIPIENT, amount, 0),
      transferLog(TEMPO_CURRENCY, OTHER_PAYER, OTHER_RECIPIENT, amount, 1),
      transferLog(TEMPO_CURRENCY, PAYER, RECIPIENT, amount, 2),
    ];
    const expect_ = { currency: TEMPO_CURRENCY, recipient: RECIPIENT, amount };

    expect(payerFromReceipt({ logs }, expect_)).toBe(getAddress(PAYER));
    expect(payerFromReceipt({ logs: logs.slice(0, 2) }, expect_)).toBeUndefined();
    expect(payerFromReceipt({ logs: [] }, expect_)).toBeUndefined();
  });
});

describe("proof", () => {
  test("refuses a proof credential for a priced offer", async () => {
    let broadcasts = 0;
    const rail = railWith({
      tempoMppx: tempoMppx(async () => {
        broadcasts += 1;
        return receipt(RECEIPT_HASH);
      }),
    });
    const requirements = rail.challenge(offer, { resource: RESOURCE, now: nowSeconds() });
    const credential = Credential.serialize(
      Credential.from({
        challenge: tempoChallenge(requirements),
        payload: { type: "proof", signature: `0x${"11".repeat(65)}` },
      }),
    );

    expect(await rail.verify(paymentFor(requirements, credential), requirements)).toEqual({
      isValid: false,
      invalidReason: "malformed",
    });
    const settled = await rail.settle(paymentFor(requirements, credential), requirements);
    expect(settled.success).toBe(false);
    expect(settled.errorReason).toBe("malformed");
    expect(broadcasts).toBe(0);
  });
});
