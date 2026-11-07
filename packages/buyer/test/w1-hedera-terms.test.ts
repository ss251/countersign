import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { canonicalHash, type Envelope, type Offer, type PaymentRequirements } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { HubClient } from "../src/hub-client.ts";
import { Journal } from "../src/journal.ts";
import { hubHederaSigner } from "../src/hedera/hub-signer.ts";
import { hederaPayer } from "../src/payer.ts";
import { State } from "../src/state.ts";
import { buy } from "../src/buy.ts";

// cs-w1 adversarial test (runs on cs/hd-33 bfd81da, PR #351, STEER-0645). A failing test here is a blocker.
// buy() binds every other rail's payment terms to the signed offer before it signs: checkTerms (countersign),
// checkDirectTerms (eip3009) and checkGatewayTerms all refuse a payee, amount or offer hash the offer does not
// name. The new hedera branch takes the hub's 402 entry as it is. The 402 is not signed by the seller, and
// `countersign buy <callUrl>` lets a link pick the hub that serves it, while the transfer is signed by the
// session's own hub. So a hub can point the user's money at another payee, another amount or another offer.
// Invariant: on the hedera rail, buy() signs nothing unless payTo = the offer's hedera payee, amount = the
// offer's price and extra.offerHash = the offer it fetched and hash-checked.

const TOKEN = "session-token-w1";
const ACCOUNT = "0.0.11337064";
const PAY_TO = "0.0.5000001";
const ATTACKER = "0.0.6666666";
const FEE_PAYER = "0.0.4000001";
const PRICE = "10000";
const NOW = 1_700_000_000;

const seller = privateKeyToAccount(generatePrivateKey());
const userKey = PrivateKey.generateECDSA();

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "echoes",
  adapter: "skill",
  input: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
  output: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["hedera"],
  payTo: { hedera: PAY_TO },
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);
const otherOfferHash = canonicalHash({ ...offer, title: "Someone else's offer", payTo: { hedera: ATTACKER } });

const honest: PaymentRequirements = {
  scheme: "exact",
  network: HEDERA_TESTNET,
  amount: PRICE,
  asset: USDC_TESTNET,
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { feePayer: FEE_PAYER, offerHash },
};

let served: PaymentRequirements = honest;
const counts = { sign: 0, paid: 0 };

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === `/offers/${offerHash}`) {
      return Response.json({ offerHash, offer, online: true, status: "listed" });
    }
    if (request.method === "POST" && url.pathname === "/cli/sign/hedera") {
      counts.sign += 1;
      const body = (await request.json()) as { transactionBytes: string };
      const tx = Transaction.fromBytes(Buffer.from(body.transactionBytes, "base64"));
      if (!(tx instanceof TransferTransaction)) return new Response("{}", { status: 400 });
      const signed = await tx.sign(userKey);
      return Response.json({ transactionBytes: Buffer.from(signed.toBytes()).toString("base64"), accountId: ACCOUNT });
    }
    if (request.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      if (!request.headers.get("payment-signature")) {
        return Response.json({ x402Version: 2, resource: { url: request.url }, accepts: [served] }, { status: 402 });
      }
      counts.paid += 1;
      return Response.json({ code: "gone", message: "Thanks." }, { status: 410 });
    }
    return new Response("{}", { status: 404 });
  },
});

afterAll(() => server.stop(true));

const HUB = `http://127.0.0.1:${server.port}`;

const envelope = (): Envelope => ({
  v: 1,
  agent: privateKeyToAccount(generatePrivateKey()).address,
  cap: "5000000",
  perMerchant: "5000000",
  allowlist: [],
  revoked: false,
});

async function buyWith(entry: PaymentRequirements): Promise<{ error: unknown }> {
  served = entry;
  counts.sign = 0;
  counts.paid = 0;
  const state = new State(mkdtempSync(join(tmpdir(), "cs-w1-hedera-terms-")));
  const journal = new Journal(state.journalPath);
  const payer = hederaPayer(
    { accountId: ACCOUNT, key: hubHederaSigner({ hub: HUB, token: TOKEN }) },
    { trusted: async () => new Set([FEE_PAYER]) },
  );
  try {
    await buy({
      hub: new HubClient(HUB),
      offerHash: offerHash as Hex,
      input: { q: "hi" },
      payers: [payer],
      envelope: envelope(),
      journal,
      state,
      now: NOW,
      approve: false,
      known: [],
      rail: "hedera",
    });
    return { error: undefined };
  } catch (error) {
    return { error };
  }
}

describe("W1: buy() on the hedera rail signs only the terms the offer names", () => {
  test("a 402 that pays someone other than the offer's hedera payee is refused before anything is signed", async () => {
    const { error } = await buyWith({ ...honest, payTo: ATTACKER });
    expect({ sign: counts.sign, paid: counts.paid }).toEqual({ sign: 0, paid: 0 });
    expect(String(error)).toMatch(/Refused/);
  });

  test("a 402 that asks for more than the offer's price is refused before anything is signed", async () => {
    const { error } = await buyWith({ ...honest, amount: "40000" });
    expect({ sign: counts.sign, paid: counts.paid }).toEqual({ sign: 0, paid: 0 });
    expect(String(error)).toMatch(/Refused/);
  });

  test("a 402 whose extra.offerHash names another offer is refused before anything is signed", async () => {
    const { error } = await buyWith({ ...honest, extra: { feePayer: FEE_PAYER, offerHash: otherOfferHash } });
    expect({ sign: counts.sign, paid: counts.paid }).toEqual({ sign: 0, paid: 0 });
    expect(String(error)).toMatch(/Refused/);
  });

  test("control: the honest 402 is signed once and paid once", async () => {
    await buyWith(honest);
    expect({ sign: counts.sign, paid: counts.paid }).toEqual({ sign: 1, paid: 1 });
  });
});
