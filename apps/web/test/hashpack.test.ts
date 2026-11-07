import { describe, expect, test } from "bun:test";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type PaymentPayload,
  type PaymentRequirements,
} from "@countersign/core";
import { proto } from "@hiero-ledger/proto";
import { AccountId, PrivateKey, TokenId, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import {
  hashpackSigner,
  paymentOnce,
  payWithHashPack,
  PINNED_FEE_PAYERS,
  trustedHashPackFeePayers,
  type WalletRequest,
} from "../src/lib/hashpack.ts";
import { hederaPayment } from "../../../packages/buyer/src/hedera/signer.ts";
import type { Listing } from "../src/lib/types.ts";

const ACCOUNT = "0.0.11337064";
const PAY_TO = "0.0.11337065";
const FEE_PAYER = "0.0.9185802";
const NODE = "0.0.3";
const OFFER_HASH = `0x${"ab".repeat(32)}`;
const HUB = "https://hub.test";

const req: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "30000",
  asset: "0.0.429274",
  payTo: PAY_TO,
  maxTimeoutSeconds: 180,
  extra: { feePayer: FEE_PAYER, offerHash: OFFER_HASH },
};

function listing(over: { price?: string; payTo?: string; rails?: Listing["offer"]["rails"] } = {}): Listing {
  return {
    hash: OFFER_HASH as Listing["hash"],
    offer: {
      v: 1,
      seller: "0x00000000000000000000000000000000000000a1",
      title: "Hedera transfer builder",
      summary: "Builds a transfer.",
      adapter: "mcp",
      input: { type: "object" },
      output: { type: "object" },
      price: over.price ?? "30000",
      deadline: 60,
      bond: "0",
      rails: over.rails ?? ["hedera"],
      payTo: { hedera: over.payTo ?? PAY_TO },
      issuedAt: 1_793_957_000,
    },
    seller: { name: "builder" },
    status: "listed",
    online: true,
  };
}

function walletStub(key: PrivateKey, seen: string[] = []): WalletRequest {
  return async (request) => {
    expect(request.method).toBe("hedera_signTransaction");
    expect(request.params.signerAccountId).toBe(`hedera:testnet:${ACCOUNT}`);
    const body = Buffer.from(request.params.transactionBody, "base64");
    seen.push(request.params.transactionBody);
    const signature = await key.sign(body);
    const pair = key.publicKey._toProtobufSignature(signature);
    const map = proto.SignatureMap.encode(proto.SignatureMap.create({ sigPair: [pair] })).finish();
    return { signatureMap: Buffer.from(map).toString("base64") };
  };
}

function signedTransaction(transaction: string) {
  const list = proto.TransactionList.decode(Buffer.from(transaction, "base64"));
  expect(list.transactionList).toHaveLength(1);
  const envelope = list.transactionList[0]!;
  expect(envelope.signedTransactionBytes?.length).toBeGreaterThan(0);
  return proto.SignedTransaction.decode(envelope.signedTransactionBytes!);
}

describe("the HashPack signer round trip", () => {
  for (const [kind, makeKey] of [
    ["ED25519", () => PrivateKey.generateED25519()],
    ["ECDSA", () => PrivateKey.generateECDSA()],
  ] as const) {
    test(`${kind}: one node, one signature over the body, the same transfer`, async () => {
      const key = makeKey();
      const seen: string[] = [];
      const { payment } = await hederaPayment(
        { accountId: ACCOUNT, key: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }) },
        req,
        `${HUB}/offers/${OFFER_HASH}/call`,
        { nodeAccountIds: [NODE] },
      );
      expect(seen).toHaveLength(1);

      const signed = signedTransaction(payment.payload.transaction as string);
      expect(signed.sigMap?.sigPair).toHaveLength(1);
      const pair = signed.sigMap!.sigPair![0]!;
      const signature = pair.ed25519 ?? pair.ECDSASecp256k1;
      expect(signature).toBeDefined();
      expect(key.publicKey.verify(signed.bodyBytes, signature!)).toBe(true);

      const tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction as string, "base64")) as TransferTransaction;
      expect(tx.nodeAccountIds).toHaveLength(1);
      expect(tx.nodeAccountIds?.[0]?.toString()).toBe(NODE);
      const transfers = tx.tokenTransfers.get(TokenId.fromString("0.0.429274"));
      expect(transfers?.get(AccountId.fromString(ACCOUNT))?.toString()).toBe("-30000");
      expect(transfers?.get(AccountId.fromString(PAY_TO))?.toString()).toBe("30000");
      expect(tx.transactionMemo).toBe(`cs1:${OFFER_HASH.slice(2)}`);
    });
  }
});

interface HubCall {
  payment: PaymentPayload | null;
  body: unknown;
}

function hubStub(
  firstResponse: () => Response,
  secondResponse: (payment: PaymentPayload) => Response,
): { fetch: typeof fetch; calls: HubCall[] } {
  const calls: HubCall[] = [];
  const stub = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const body = (await request.json()) as unknown;
      const header = request.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!header) {
        calls.push({ payment: null, body });
        return firstResponse();
      }
      const payment = fromBase64Json<PaymentPayload>(header);
      calls.push({ payment, body });
      return secondResponse(payment);
    },
    { preconnect: () => undefined },
  ) as unknown as typeof fetch;
  return { fetch: stub, calls };
}

function required(): Response {
  return requiredFor();
}

function requiredFor(over: Partial<PaymentRequirements> = {}): Response {
  const body = { x402Version: 2, resource: { url: `${HUB}/offers/${OFFER_HASH}/call` }, accepts: [{ ...req, ...over }] };
  return Response.json(body, {
    status: 402,
    headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(body) },
  });
}

/** The browser's fetch, with the facilitators' /supported left unreachable as x402.org's CORS-less one is. */
function consoleFetch(hub: typeof fetch): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith("/supported")) throw new TypeError("Failed to fetch");
      return hub(input, init);
    },
    { preconnect: () => undefined },
  ) as unknown as typeof fetch;
}

function paid(payment: PaymentPayload): Response {
  const tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction as string, "base64")) as TransferTransaction;
  const transactionId = tx.transactionId!.toString();
  return Response.json({
    output: { ok: true },
    slip: {
      hash: `0x${"cd".repeat(32)}`,
      settlement: {
        transaction: transactionId,
        network: "hedera:testnet",
        url: `https://hashscan.io/testnet/transaction/${transactionId}`,
      },
    },
  });
}

describe("paying with HashPack sends the agent's payment", () => {
  test("the payload is x402Version 2, the accepted requirements, and the signed transaction", async () => {
    const key = PrivateKey.generateECDSA();
    const hub = hubStub(required, paid);
    const steps: string[] = [];
    const result = await payWithHashPack(
      { hub: HUB, listing: listing(), input: { question: "hi" } },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key) }),
        fetch: hub.fetch,
        trustedFeePayers: async () => new Set([FEE_PAYER]),
        nodeAccountId: NODE,
        onStep: (step) => steps.push(step),
      },
    );

    expect(hub.calls).toHaveLength(2);
    const payment = hub.calls[1]!.payment!;
    expect(payment.x402Version).toBe(2);
    expect(payment.accepted).toEqual(req);
    expect(payment.payload).toEqual({ transaction: expect.any(String) });
    expect(payment.resource).toEqual({ url: `${HUB}/offers/${OFFER_HASH}/call` });
    expect(Object.keys(payment).sort()).toEqual(["accepted", "payload", "resource", "x402Version"]);

    const tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction as string, "base64")) as TransferTransaction;
    expect(tx.tokenTransfers.size).toBe(1);
    expect(tx.nodeAccountIds).toHaveLength(1);
    expect(result.transactionId).toBe(tx.transactionId!.toString());
    expect(result.settlementUrl).toBe(`https://hashscan.io/testnet/transaction/${tx.transactionId!.toString()}`);
    expect(steps).toEqual(["signed", "working", "checked", "settled", "minted"]);
  });

  test("an untrusted fee payer is refused before the wallet signs", async () => {
    const key = PrivateKey.generateECDSA();
    const seen: string[] = [];
    const hub = hubStub(required, paid);
    const error = await payWithHashPack(
      { hub: HUB, listing: listing(), input: {} },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }),
        fetch: hub.fetch,
        trustedFeePayers: async () => new Set(["0.0.9999999"]),
        nodeAccountId: NODE,
      },
    ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Refused. The hub named a fee payer this page does not trust.");
    expect(seen).toHaveLength(0);
    expect(hub.calls).toHaveLength(1);
  });

  test("terms that differ from the offer are refused before the wallet signs", async () => {
    const key = PrivateKey.generateECDSA();
    const seen: string[] = [];
    const hub = hubStub(required, paid);
    const error = await payWithHashPack(
      { hub: HUB, listing: listing({ price: "31000" }), input: {} },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }),
        fetch: hub.fetch,
        trustedFeePayers: async () => new Set([FEE_PAYER]),
        nodeAccountId: NODE,
      },
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe("Refused. The hub asked for terms that differ from the offer.");
    expect(seen).toHaveLength(0);
  });

  test("a hub refusal after signing is shown in the hub's own words", async () => {
    const key = PrivateKey.generateECDSA();
    const message = "Refused. The seller is offline. Nothing was charged.";
    const hub = hubStub(required, () => Response.json({ code: "seller-offline", message }, { status: 503 }));
    const error = await payWithHashPack(
      { hub: HUB, listing: listing(), input: {} },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key) }),
        fetch: hub.fetch,
        trustedFeePayers: async () => new Set([FEE_PAYER]),
        nodeAccountId: NODE,
      },
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe(message);
  });
});

describe("the fee payers this page trusts", () => {
  test("pins x402.org's fee payer even when no facilitator can be read", async () => {
    const unreachable = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const trusted = await trustedHashPackFeePayers(unreachable);
    expect([...trusted]).toEqual([...PINNED_FEE_PAYERS]);
    expect(trusted.has(FEE_PAYER)).toBe(true);
  });

  test("adds the fee payer a CORS-readable facilitator publishes", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://x402.org/")) throw new TypeError("Failed to fetch");
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.777" } }],
      });
    }) as unknown as typeof fetch;
    const trusted = await trustedHashPackFeePayers(fetchImpl);
    expect([...trusted].sort()).toEqual(["0.0.777", ...PINNED_FEE_PAYERS].sort());
  });
});

describe("paying when the facilitators send no CORS header", () => {
  test("a 402 naming the pinned fee payer is trusted", async () => {
    const key = PrivateKey.generateECDSA();
    const hub = hubStub(required, paid);
    const result = await payWithHashPack(
      { hub: HUB, listing: listing(), input: {} },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key) }),
        fetch: consoleFetch(hub.fetch),
        nodeAccountId: NODE,
      },
    );
    expect(result.transactionId).toBeTruthy();
    expect(hub.calls).toHaveLength(2);
  });

  test("a 402 naming any other fee payer is refused before the wallet signs", async () => {
    const key = PrivateKey.generateECDSA();
    const seen: string[] = [];
    const hub = hubStub(() => requiredFor({ extra: { feePayer: "0.0.123", offerHash: OFFER_HASH } }), paid);
    const error = await payWithHashPack(
      { hub: HUB, listing: listing(), input: {} },
      {
        accountId: ACCOUNT,
        signer: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }),
        fetch: consoleFetch(hub.fetch),
        nodeAccountId: NODE,
      },
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe("Refused. The hub named a fee payer this page does not trust.");
    expect(seen).toHaveLength(0);
    expect(hub.calls).toHaveLength(1);
  });
});

describe("the 402's terms must match the offer", () => {
  const cases: Array<{
    name: string;
    terms?: Partial<PaymentRequirements>;
    rails?: Listing["offer"]["rails"];
    message: string;
  }> = [
    {
      name: "another asset",
      terms: { asset: "0.0.999999" },
      message: "Refused. The hub asked for a token this page will not sign.",
    },
    {
      name: "another network",
      terms: { network: "eip155:84532" as PaymentRequirements["network"] },
      message: "Refused. The hub offered no hedera payment for this offer.",
    },
    {
      name: "another scheme",
      terms: { scheme: "countersign" },
      message: "Refused. The hub offered no hedera payment for this offer.",
    },
    {
      name: "an offer without hedera in its rails",
      rails: ["escrow"],
      message: "Refused. This offer does not take the hedera rail.",
    },
  ];

  for (const c of cases) {
    test(`${c.name} is refused before the wallet signs`, async () => {
      const key = PrivateKey.generateECDSA();
      const seen: string[] = [];
      const hub = hubStub(() => requiredFor(c.terms), paid);
      const error = await payWithHashPack(
        { hub: HUB, listing: listing({ rails: c.rails }), input: {} },
        {
          accountId: ACCOUNT,
          signer: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }),
          fetch: hub.fetch,
          trustedFeePayers: async () => new Set([FEE_PAYER]),
          nodeAccountId: NODE,
        },
      ).catch((e: Error) => e);
      expect((error as Error).message).toBe(c.message);
      expect(seen).toHaveLength(0);
      expect(hub.calls.filter((call) => call.payment !== null)).toHaveLength(0);
    });
  }
});

describe("one payment at a time", () => {
  test("two rapid pay calls sign exactly one hedera transaction", async () => {
    const key = PrivateKey.generateECDSA();
    const seen: string[] = [];
    const hub = hubStub(required, paid);
    const flag = { current: false };
    const pay = paymentOnce(flag, async () => {
      await payWithHashPack(
        { hub: HUB, listing: listing(), input: {} },
        {
          accountId: ACCOUNT,
          signer: hashpackSigner(ACCOUNT, { request: walletStub(key, seen) }),
          fetch: hub.fetch,
          trustedFeePayers: async () => new Set([FEE_PAYER]),
          nodeAccountId: NODE,
        },
      );
    });
    await Promise.all([pay(), pay()]);
    expect(seen).toHaveLength(1);
    expect(hub.calls).toHaveLength(2);
  });
});
