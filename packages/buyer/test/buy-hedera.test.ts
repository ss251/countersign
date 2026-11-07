import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountId, PrivateKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import { keccak256, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  PAYMENT_SIGNATURE_HEADER,
  canonicalHash,
  fromBase64Json,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
} from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { HubClient } from "../src/hub-client.ts";
import { Journal } from "../src/journal.ts";
import { hubHederaSigner } from "../src/hedera/hub-signer.ts";
import { hederaPayer } from "../src/payer.ts";
import { State } from "../src/state.ts";
import { buy } from "../src/buy.ts";

const TOKEN = "session-token-9c1d";
const ACCOUNT = "0.0.11337064";
const PAY_TO = "0.0.5000001";
const FEE_PAYER = "0.0.4000001";
const PRICE = "250000";
const NOW = 1_700_000_000;

const seller = privateKeyToAccount(generatePrivateKey());
const localKey = PrivateKey.generateECDSA();

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
  rails: ["hedera", "hedera-scheduled"],
  payTo: { hedera: PAY_TO, "hedera-scheduled": PAY_TO },
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

const hedera: PaymentRequirements = {
  scheme: "exact",
  network: HEDERA_TESTNET,
  amount: PRICE,
  asset: USDC_TESTNET,
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { feePayer: FEE_PAYER, offerHash },
};

const scheduled: PaymentRequirements = {
  scheme: "countersign",
  network: HEDERA_TESTNET,
  amount: PRICE,
  asset: USDC_TESTNET,
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { name: "hedera-scheduled", offerHash, holdSeconds: 300 },
};

const counts = { sign: 0, paid: 0 };

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === `/offers/${offerHash}`) {
      return Response.json({ offerHash, offer, online: true, status: "listed" });
    }
    if (request.method === "POST" && url.pathname === "/cli/sign/hedera") {
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
        return Response.json({ code: "no-session", message: "No session." }, { status: 401 });
      }
      counts.sign += 1;
      const body = (await request.json()) as { offerHash: string; transactionBytes: string };
      const tx = Transaction.fromBytes(Buffer.from(body.transactionBytes, "base64"));
      if (!(tx instanceof TransferTransaction)) return new Response("{}", { status: 400 });
      const signed = await tx.sign(localKey);
      return Response.json({
        transactionBytes: Buffer.from(signed.toBytes()).toString("base64"),
        accountId: ACCOUNT,
      });
    }
    if (request.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      const body = (await request.json()) as { input: { q: string } };
      const header = request.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!header) {
        return Response.json(
          { x402Version: 2, resource: { url: request.url }, accepts: [scheduled, hedera] },
          { status: 402 },
        );
      }
      counts.paid += 1;
      const payment = fromBase64Json<PaymentPayload>(header);
      const encoded = payment.payload.transaction;
      if (typeof encoded !== "string") {
        return Response.json({ code: "bad-payment", message: "No transfer." }, { status: 400 });
      }
      const tx = Transaction.fromBytes(Buffer.from(encoded, "base64"));
      if (!(tx instanceof TransferTransaction) || !localKey.publicKey.verifyTransaction(tx)) {
        return Response.json({ code: "bad-payment", message: "Not signed." }, { status: 400 });
      }
      const legs = tx.tokenTransfers.get(USDC_TESTNET);
      const moved = legs?.get(AccountId.fromString(PAY_TO))?.toString();
      if (moved !== PRICE) {
        return Response.json({ code: "bad-payment", message: "Wrong amount." }, { status: 400 });
      }
      const output = { a: body.input.q };
      const jobId = keccak256(toBytes(tx.transactionId!.toString()));
      const slipBody = slipBodyFor(
        {
          jobId,
          offerHash: offerHash as Hex,
          input: body.input,
          rail: "hedera",
          network: HEDERA_TESTNET,
          buyer: ACCOUNT,
          payTo: PAY_TO,
          asset: USDC_TESTNET,
          amount: PRICE,
          deadline: NOW + 120,
          lineage: [],
        },
        seller.address,
        canonicalHash(body.input),
        canonicalHash(output),
        NOW,
      );
      const slip = {
        body: slipBody,
        hash: slipHash(slipBody),
        sellerSig: await seller.signTypedData(slipTypedData(slipBody)),
        payment,
        settlement: { transaction: tx.transactionId!.toString(), network: HEDERA_TESTNET },
      };
      return Response.json({ output, slip });
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

describe("buy --rail hedera", () => {
  test("pays the hedera entry, never the scheduled one, and settles the slip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-buyer-hedera-"));
    const state = new State(dir);
    const journal = new Journal(state.journalPath);
    const payer = hederaPayer(
      { accountId: ACCOUNT, key: hubHederaSigner({ hub: HUB, token: TOKEN }) },
      { trusted: async () => new Set([FEE_PAYER]) },
    );

    const result = await buy({
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

    expect(result.output).toEqual({ a: "hi" });
    expect(counts.sign).toBe(1);
    expect(counts.paid).toBe(1);
    expect(journal.entries().map((entry) => entry.kind)).toEqual(["countersigned", "signed", "settled"]);
    expect(journal.entries()[1]?.rail).toBe("hedera");
  });
});
