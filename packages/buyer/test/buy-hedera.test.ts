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
  checkCountersign,
  fromBase64Json,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type CountersignExtra,
  type CountersignPayload,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
} from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { HubClient } from "../src/hub-client.ts";
import { Journal } from "../src/journal.ts";
import { hubHederaAccountReadOnly, hubHederaSigner } from "../src/hedera/hub-signer.ts";
import { countersignPayer, hederaPayer } from "../src/payer.ts";
import type { KnownRail } from "../src/known-rails.ts";
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

const ARC_TOKEN = "0x3600000000000000000000000000000000000000";
const ARC_ESCROW = "0x4444444444444444444444444444444444444444";
const ARC_RAIL: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow: ARC_ESCROW,
  token: ARC_TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "https://rpc.testnet.arc.network",
};

const arcOffer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo on Arc",
  summary: "echoes",
  adapter: "skill",
  input: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
  output: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
const arcOfferHash = canonicalHash(arcOffer);
const arcExtra: CountersignExtra = {
  rail: "escrow",
  escrow: ARC_ESCROW,
  chainId: 5042002,
  offerHash: arcOfferHash,
  deadlineSeconds: 120,
  tokenName: "USDC",
  tokenVersion: "2",
};
const arcEntry: PaymentRequirements = {
  scheme: "countersign",
  network: "eip155:5042002",
  amount: PRICE,
  asset: ARC_TOKEN,
  payTo: seller.address,
  maxTimeoutSeconds: 120,
  extra: { ...arcExtra },
};

const counts = { sign: 0, paid: 0 };
const paths: string[] = [];
let sessionAccount: string | null = null;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    paths.push(`${request.method} ${url.pathname}`);
    if (request.method === "GET" && url.pathname === "/cli/session") {
      return Response.json({
        address: seller.address,
        expiresAt: 4_000_000_000,
        hedera: sessionAccount === null ? null : { accountId: sessionAccount },
      });
    }
    if (request.method === "POST" && url.pathname === "/cli/hedera/account") {
      return Response.json({ accountId: ACCOUNT });
    }
    if (request.method === "GET" && url.pathname === `/offers/${arcOfferHash}`) {
      return Response.json({ offerHash: arcOfferHash, offer: arcOffer, online: true, status: "listed" });
    }
    if (request.method === "POST" && url.pathname === `/offers/${arcOfferHash}/call`) {
      const body = (await request.json()) as { input: { q: string } };
      const header = request.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!header) {
        return Response.json({ x402Version: 2, resource: { url: request.url }, accepts: [arcEntry] }, { status: 402 });
      }
      counts.paid += 1;
      const payment = fromBase64Json<PaymentPayload>(header);
      const payload = payment.payload as unknown as CountersignPayload;
      const chk = await checkCountersign(payload, {
        chainId: 5042002,
        escrow: ARC_ESCROW,
        token: ARC_TOKEN,
        tokenName: "USDC",
        tokenVersion: "2",
        now: Math.floor(Date.now() / 1000),
      });
      if (!chk.ok) return Response.json({ code: "bad-payment", message: chk.message }, { status: 400 });
      const output = { a: body.input.q };
      const slipBody = slipBodyFor(
        {
          jobId: payload.authorization.nonce,
          offerHash: arcOfferHash as Hex,
          input: body.input,
          rail: "escrow",
          network: "eip155:5042002",
          buyer: payload.terms.buyer,
          payTo: seller.address,
          asset: ARC_TOKEN,
          amount: PRICE,
          deadline: payload.terms.deadline,
          escrow: ARC_ESCROW,
          chainId: 5042002,
          lineage: [],
        },
        seller.address,
        canonicalHash(body.input),
        canonicalHash(output),
        Math.floor(Date.now() / 1000),
      );
      const slip = {
        body: slipBody,
        hash: slipHash(slipBody),
        sellerSig: await seller.signTypedData(slipTypedData(slipBody)),
        payment,
        settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
      };
      return Response.json({ output, slip });
    }
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

describe("the hedera account is looked up only when a hedera entry pays", () => {
  const session = { hub: HUB, token: TOKEN };
  const lazyPayer = () =>
    hederaPayer(
      { accountId: () => hubHederaAccountReadOnly(session), key: hubHederaSigner(session) },
      { trusted: async () => new Set([FEE_PAYER]) },
    );

  test("an Arc buy with a session never reads or provisions a hedera account", async () => {
    sessionAccount = ACCOUNT;
    paths.length = 0;
    const state = new State(mkdtempSync(join(tmpdir(), "cs-buyer-arc-")));
    const journal = new Journal(state.journalPath);
    const account = privateKeyToAccount(generatePrivateKey());

    const result = await buy({
      hub: new HubClient(HUB),
      offerHash: arcOfferHash as Hex,
      input: { q: "hi" },
      payers: [countersignPayer(account), lazyPayer()],
      envelope: envelope(),
      journal,
      state,
      now: Math.floor(Date.now() / 1000),
      approve: false,
      known: [ARC_RAIL],
      rail: "escrow",
    });

    expect(result.output).toEqual({ a: "hi" });
    expect(paths).not.toContain("GET /cli/session");
    expect(paths).not.toContain("POST /cli/hedera/account");
  });

  test("a hedera buy with no account in the session fails before anything is signed", async () => {
    sessionAccount = null;
    paths.length = 0;
    counts.sign = 0;
    counts.paid = 0;
    const state = new State(mkdtempSync(join(tmpdir(), "cs-buyer-hedera-none-")));
    const journal = new Journal(state.journalPath);

    let error: unknown;
    try {
      await buy({
        hub: new HubClient(HUB),
        offerHash: offerHash as Hex,
        input: { q: "hi" },
        payers: [lazyPayer()],
        envelope: envelope(),
        journal,
        state,
        now: NOW,
        approve: false,
        known: [],
        rail: "hedera",
      });
    } catch (e) {
      error = e;
    }

    expect(String(error)).toContain("No Hedera account yet. Run: countersign whoami");
    expect(counts).toEqual({ sign: 0, paid: 0 });
    expect(paths).toContain("GET /cli/session");
    expect(paths).not.toContain("POST /cli/hedera/account");
  });

  test("a hedera buy reads the session account and never provisions one", async () => {
    sessionAccount = ACCOUNT;
    paths.length = 0;
    counts.sign = 0;
    counts.paid = 0;
    const state = new State(mkdtempSync(join(tmpdir(), "cs-buyer-hedera-read-")));
    const journal = new Journal(state.journalPath);

    const result = await buy({
      hub: new HubClient(HUB),
      offerHash: offerHash as Hex,
      input: { q: "hi" },
      payers: [lazyPayer()],
      envelope: envelope(),
      journal,
      state,
      now: NOW,
      approve: false,
      known: [],
      rail: "hedera",
    });

    expect(result.output).toEqual({ a: "hi" });
    expect(counts).toEqual({ sign: 1, paid: 1 });
    expect(paths).toContain("GET /cli/session");
    expect(paths).not.toContain("POST /cli/hedera/account");
  });
});
