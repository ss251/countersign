import { describe, expect, test } from "bun:test";
import {
  AccountId,
  PrivateKey,
  TokenId,
  Transaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import type { PaymentRequirements } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { hubHederaSigner } from "../src/hedera/hub-signer.ts";
import { HederaSignError } from "../src/hedera/signer.ts";
import { hederaPayer } from "../src/payer.ts";
import { NOT_SIGNED_IN } from "../src/remote-signer.ts";

const TOKEN = "session-token-4f2a";
const ACCOUNT = "0.0.11337064";
const PAY_TO = "0.0.5000001";
const FEE_PAYER = "0.0.4000001";
const OFFER_HASH = `0x${"ab".repeat(32)}`;
const HUB = "http://127.0.0.1:8787";

const session = { hub: HUB, token: TOKEN };

const req: PaymentRequirements = {
  scheme: "exact",
  network: HEDERA_TESTNET,
  amount: "10000",
  asset: USDC_TESTNET,
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { feePayer: FEE_PAYER, offerHash: OFFER_HASH },
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function asTransfer(encoded: string): TransferTransaction {
  const decoded = Transaction.fromBytes(Buffer.from(encoded, "base64"));
  if (!(decoded instanceof TransferTransaction)) throw new Error("not a transfer");
  return decoded;
}

function signingStub(key: PrivateKey): typeof fetch {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) {
        return response({ code: "no-session", message: "No session." }, 401);
      }
      const body = (await request.json()) as { offerHash: string; transactionBytes: string };
      const tx = asTransfer(body.transactionBytes);
      const signed = await tx.sign(key);
      return response({
        transactionBytes: Buffer.from(signed.toBytes()).toString("base64"),
        accountId: ACCOUNT,
      });
    },
    { preconnect: () => undefined },
  );
}

function statusStub(status: number, body: unknown): typeof fetch {
  return Object.assign(async (): Promise<Response> => response(body, status), {
    preconnect: () => undefined,
  });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the promise to reject");
}

describe("the remote hedera path", () => {
  test("the payment verifies, moves the USDC and carries the memo, fee payer and one node", async () => {
    const key = PrivateKey.generateECDSA();
    const payer = hederaPayer(
      { accountId: ACCOUNT, key: hubHederaSigner(session, { fetchImpl: signingStub(key) }) },
      { trusted: async () => new Set([FEE_PAYER]) },
    );

    const { payment, jobId } = await payer.pay(req, { now: 1_700_000_000 });
    const transaction = asTransfer((payment.payload as { transaction: string }).transaction);

    expect(key.publicKey.verifyTransaction(transaction)).toBe(true);

    const tokenTransfers = transaction.tokenTransfers.get(TokenId.fromString(USDC_TESTNET));
    expect(tokenTransfers).not.toBeNull();
    expect(BigInt(tokenTransfers!.get(AccountId.fromString(ACCOUNT))!.toString())).toBe(-10000n);
    expect(BigInt(tokenTransfers!.get(AccountId.fromString(PAY_TO))!.toString())).toBe(10000n);

    expect(transaction.transactionMemo).toBe(`cs1:${OFFER_HASH.slice(2)}`);
    expect(transaction.transactionId?.accountId?.toString()).toBe(FEE_PAYER);
    expect(transaction.nodeAccountIds).toHaveLength(1);
    expect(jobId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("a hub that returns a different transfer is refused", async () => {
    const key = PrivateKey.generateECDSA();
    const tampered = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        const body = (await request.json()) as { transactionBytes: string };
        const original = asTransfer(body.transactionBytes);
        const token = TokenId.fromString(USDC_TESTNET);
        const changed = new TransferTransaction()
          .addTokenTransfer(token, AccountId.fromString(ACCOUNT), -20000n)
          .addTokenTransfer(token, AccountId.fromString(PAY_TO), 20000n)
          .setTransactionId(original.transactionId!)
          .setTransactionMemo(original.transactionMemo)
          .setTransactionValidDuration(original.transactionValidDuration)
          .setNodeAccountIds(original.nodeAccountIds ?? []);
        changed.freeze();
        const signed = await changed.sign(key);
        return response({ transactionBytes: Buffer.from(signed.toBytes()).toString("base64"), accountId: ACCOUNT });
      },
      { preconnect: () => undefined },
    );

    const payer = hederaPayer(
      { accountId: ACCOUNT, key: hubHederaSigner(session, { fetchImpl: tampered }) },
      { trusted: async () => new Set([FEE_PAYER]) },
    );
    const error = await rejection(payer.pay(req, { now: 1_700_000_000 }));
    expect(error).toBeInstanceOf(HederaSignError);
    expect(error.message).toBe("The hub returned a different transfer.");
  });

  test("an untrusted fee payer is refused before any hub call", async () => {
    const key = PrivateKey.generateECDSA();
    let calls = 0;
    const stub = Object.assign(
      async (): Promise<Response> => {
        calls += 1;
        return response({});
      },
      { preconnect: () => undefined },
    );
    const payer = hederaPayer(
      { accountId: ACCOUNT, key: hubHederaSigner(session, { fetchImpl: stub }) },
      { trusted: async () => new Set(["0.0.9999999"]) },
    );

    const error = await rejection(payer.pay(req, { now: 1_700_000_000 }));
    expect(error.message).toBe("Refused. The hub named a fee payer this agent does not trust.");
    expect(calls).toBe(0);
  });
});

describe("hubHederaSigner error mapping", () => {
  const cases: Array<[string, number, unknown, string]> = [
    ["401", 401, { code: "no-session", message: "Expired." }, NOT_SIGNED_IN],
    ["403", 403, { code: "refused", message: "Over the cap." }, "Over the cap."],
    ["404", 404, { code: "off", message: "Off." }, "This hub does not sign Hedera payments yet."],
    ["409", 409, { code: "no-account", message: "None." }, "No Hedera account yet. Run: countersign whoami"],
    ["502", 502, { code: "privy-failed", message: "No." }, "The hub could not sign (502)."],
  ];

  test("each status has its own message and no message carries the token", async () => {
    for (const [_name, status, body, message] of cases) {
      const signer = hubHederaSigner(session, { fetchImpl: statusStub(status, body) });
      const error = await rejection(signer.signTransfer("AAAA", OFFER_HASH));
      expect(error.message).toBe(message);
      expect(error.message).not.toContain(TOKEN);
    }
  });
});
