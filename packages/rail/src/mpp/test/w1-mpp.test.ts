import { describe, expect, test } from "bun:test";
import type { Offer, PaymentPayload, PaymentRequirements } from "@countersign/core";
import { Challenge, Credential } from "mppx";
import { createMppRail, type SettledStore } from "../rail.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// The rail treats a challenge id as one purchase (the replay store is keyed on it), but a
// challenge is a pure function of the offer and the whole second it was issued in: there is no
// per-issuance nonce. Two buyers who get a 402 for one offer in the same second hold the same
// challenge. Push-mode credentials ({type: "hash"}) are accepted, so the second buyer's transfer is
// already on chain when the rail refuses it as a replay of the first buyer's purchase; and anyone who
// fetched that second's 402 can present a buyer's on-chain transfer as their own.

const SECRET = "s".repeat(32);
const REALM = "localhost";
const offer: Offer = {
  v: 1,
  seller: "0x1111111111111111111111111111111111111111",
  title: "W1 MPP offer",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  deadline: 3600,
  bond: "0",
  rails: ["mpp"],
  payTo: { mpp: "0x00000000000000000000000000000000000000aa" },
  issuedAt: 1_793_957_000,
};

function settled(): SettledStore {
  const ids = new Set<string>();
  return {
    has: (id) => ids.has(id),
    claim: (id) => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
  };
}

function tempoChallenge(requirements: PaymentRequirements) {
  const mpp = requirements.extra?.mpp as { wwwAuthenticate: string };
  const found = Challenge.deserializeList(mpp.wwwAuthenticate).find((c) => c.method === "tempo");
  if (!found) throw new Error("no tempo challenge");
  return found;
}

function pushPayment(requirements: PaymentRequirements, txHash: string): PaymentPayload {
  const credential = Credential.serialize(
    Credential.from({ challenge: tempoChallenge(requirements), payload: { type: "hash", hash: txHash } }),
  );
  return { x402Version: 2, accepted: requirements, payload: { credential }, resource: { url: "http://localhost/paid" } };
}

describe("W1 B17: two 402s for one offer in one second are one purchase", () => {
  test("a second buyer's challenge is never the first buyer's", async () => {
    const seen = settled();
    const rail = createMppRail({ secretKey: SECRET, realm: REALM, seen });
    const now = Math.floor(Date.now() / 1000);
    const forA = rail.challenge(offer, { resource: "http://localhost/paid", now });
    const forB = rail.challenge(offer, { resource: "http://localhost/paid", now });

    // Buyer A's purchase settles and claims its challenge.
    await seen.claim(tempoChallenge(forA).id);

    // Buyer B paid its own 402 (push mode: its transfer is already on chain) and presents it.
    const b = await rail.verify(pushPayment(forB, "0x22"), forB); // a short hash: once fixed, mppx refuses it offline
    expect(b.invalidReason).not.toBe("replay");
    expect(tempoChallenge(forB).id).not.toBe(tempoChallenge(forA).id);
  });
});
