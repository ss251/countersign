import { describe, expect, test } from "bun:test";
import {
  offerHash,
  PAYMENT_REQUIRED_HEADER,
  toBase64Json,
  type Envelope,
  type Offer,
  type PaymentRequired,
  type PaymentRequirements,
} from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createHederaAgent, type HederaAgentOptions, type Listing } from "../agent.ts";
import type { SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";

const payer = { accountId: PAYER, key: PrivateKey.generateECDSA() };

function offer(): Offer {
  return {
    v: 1,
    seller: SELLER,
    title: "Hedera transfer builder",
    summary: "Builds an unsigned HBAR transfer for the caller to sign.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: 1793957000,
  };
}

function listing(o: Offer): Listing {
  return { offerHash: offerHash(o), offer: o, online: true, status: "listed" };
}

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    agent: "0x00000000000000000000000000000000000000b2",
    cap: "0",
    perMerchant: "500000",
    allowlist: [],
    revoked: false,
    ...over,
  };
}

/** A hub that only ever returns the 402 challenge, for buys that stop before signing. */
function hubFetch(target: Listing): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname !== `/offers/${target.offerHash}/call`) {
      return new Response("not found", { status: 404 });
    }
    const req: PaymentRequirements = {
      scheme: "exact",
      network: HEDERA_TESTNET,
      amount: target.offer.price,
      asset: USDC_TESTNET,
      payTo: PAYEE,
      maxTimeoutSeconds: 180,
      extra: { feePayer: FEE_PAYER, offerHash: target.offerHash },
    };
    const required: PaymentRequired = { x402Version: 2, resource: { url: url.toString() }, accepts: [req] };
    return new Response(JSON.stringify(required), {
      status: 402,
      headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(required) },
    });
  }) as unknown as typeof fetch;
}

function agentFor(
  target: Listing,
  env: Envelope,
  lookupFeePayers: () => Promise<Set<string>>,
  over: Partial<HederaAgentOptions> = {},
) {
  const entries: SpendEntry[] = [];
  const agent = createHederaAgent({
    hub: "http://hub.test",
    payer,
    envelope: env,
    topicId: TOPIC,
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    fetch: hubFetch(target),
    lookupFeePayers,
    ...over,
  });
  return { agent, entries };
}

describe("hedera trust cache", () => {
  test("an empty lookup is retried on the next buy", async () => {
    const target = listing(offer());
    let lookups = 0;
    const { agent } = agentFor(target, envelope(), async () => {
      lookups++;
      return lookups === 1 ? new Set<string>() : new Set([FEE_PAYER]);
    });

    const first = await agent.buy(target, {});
    expect(first).toMatchObject({ kind: "refused", reason: "untrusted-fee-payer" });
    expect(lookups).toBe(1);

    // The envelope cap is zero, so passing the trust check shows as an over-cap refusal.
    const second = await agent.buy(target, {});
    expect(second).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(lookups).toBe(2);
  });

  test("a non-empty lookup is cached across buys", async () => {
    const target = listing(offer());
    let lookups = 0;
    const { agent } = agentFor(target, envelope(), async () => {
      lookups++;
      return new Set([FEE_PAYER]);
    });

    expect(await agent.buy(target, {})).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(await agent.buy(target, {})).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(lookups).toBe(1);
  });

  test("an explicit trusted list never looks up the facilitators", async () => {
    const target = listing(offer());
    let lookups = 0;
    const { agent } = agentFor(
      target,
      envelope(),
      async () => {
        lookups++;
        return new Set<string>();
      },
      { trustedFeePayers: [FEE_PAYER] },
    );

    expect(await agent.buy(target, {})).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(await agent.buy(target, {})).toMatchObject({ kind: "refused", reason: "over-cap" });
    expect(lookups).toBe(0);
  });
});
