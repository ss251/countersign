import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  canonicalHash,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type Slip,
} from "@countersign/core";
import {
  Journal,
  KNOWN_DIRECTS,
  KNOWN_GATEWAYS,
  State,
  buy,
  checkDirectTerms,
  eip3009Payer,
  gatewayPayer,
  type HubClient,
  type Payer,
} from "../src/index.ts";

// Fixed anvil keys; they hold nothing anywhere else.
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const thief = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const PRICE = "250000";
const NOW = 1_762_400_000;
const DIRECT = KNOWN_DIRECTS[0]!;
const GATEWAY = KNOWN_GATEWAYS[0]!;
const RESOURCE = {
  url: "http://hub.test/offers/0x00/call",
  description: "Direct echo",
  mimeType: "application/json",
};

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Direct echo",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["eip3009"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

interface AcceptOverrides {
  asset?: string;
  name?: string;
  version?: string;
  payTo?: string;
  amount?: string;
  maxTimeoutSeconds?: number;
}

function accept(over: AcceptOverrides = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: DIRECT.network,
    amount: over.amount ?? PRICE,
    asset: over.asset ?? DIRECT.asset,
    payTo: over.payTo ?? seller.address,
    maxTimeoutSeconds: over.maxTimeoutSeconds ?? 120,
    extra: {
      name: over.name ?? DIRECT.name,
      version: over.version ?? DIRECT.version,
    },
  };
}

function gatewayAccept(): PaymentRequirements {
  return {
    scheme: "exact",
    network: GATEWAY.network,
    amount: PRICE,
    asset: GATEWAY.asset,
    payTo: seller.address,
    maxTimeoutSeconds: 120,
    extra: {
      name: GATEWAY.name,
      version: GATEWAY.version,
      verifyingContract: GATEWAY.verifyingContract,
    },
  };
}

function envelope(): Envelope {
  return {
    v: 1,
    agent: buyer.address,
    cap: "10000000",
    perMerchant: "10000000",
    allowlist: [seller.address],
    revoked: false,
  };
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "cs-eip3009-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}

function fakeHub(accepts: PaymentRequirements[]) {
  let paidPayment: PaymentPayload | undefined;
  let paidCalls = 0;
  const hub = {
    getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
    call: async (_hash: string, input: unknown, payment?: PaymentPayload) => {
      if (!payment) {
        const required: PaymentRequired = { x402Version: 2, resource: RESOURCE, accepts };
        return { kind: "required", required };
      }
      paidCalls += 1;
      paidPayment = payment;
      const authorization = payment.payload.authorization as { nonce: Hex; from: Address };
      const gateway = payment.accepted.extra?.name === "GatewayWalletBatched";
      const output = { ok: true };
      const body = slipBodyFor(
        {
          jobId: authorization.nonce,
          offerHash,
          input,
          rail: gateway ? "gateway" : "eip3009",
          network: payment.accepted.network,
          buyer: authorization.from,
          payTo: seller.address,
          asset: payment.accepted.asset,
          amount: PRICE,
          deadline: NOW + 120,
          lineage: [],
        },
        seller.address,
        canonicalHash(input),
        canonicalHash(output),
        NOW + 1,
      );
      const slip: Slip = {
        body,
        hash: slipHash(body),
        sellerSig: await seller.signTypedData(slipTypedData(body)),
        payment,
        settlement: {
          transaction: gateway ? "0b7c2d27-9a4d-4f6e-b0bd-61a4b1b8c3aa" : `0x${"cd".repeat(32)}`,
          network: payment.accepted.network,
        },
      };
      return { kind: "paid", result: { output, slip }, settle: null };
    },
  } as unknown as HubClient;
  return {
    hub,
    paidPayment: () => paidPayment,
    paidCalls: () => paidCalls,
  };
}

function buyOnce(
  f: ReturnType<typeof fresh>,
  hub: HubClient,
  payers: Payer[],
  extra: { rail?: "eip3009" | "gateway" } = {},
) {
  return buy({
    hub,
    offerHash,
    input: {},
    payers,
    envelope: envelope(),
    journal: f.journal,
    state: f.state,
    now: NOW,
    known: [],
    ...extra,
  });
}

describe("direct terms", () => {
  test("a pinned Arc USDC entry is accepted", () => {
    const checked = checkDirectTerms(offer, accept(), KNOWN_DIRECTS);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.direct).toEqual(DIRECT);
  });

  test("a different asset is refused", () => {
    expect(checkDirectTerms(offer, accept({ asset: thief.address }), KNOWN_DIRECTS).ok).toBe(false);
  });

  test("a domain name other than USDC is refused", () => {
    expect(checkDirectTerms(offer, accept({ name: "NotUSDC" }), KNOWN_DIRECTS).ok).toBe(false);
  });

  test("a different payTo is refused", () => {
    expect(checkDirectTerms(offer, accept({ payTo: thief.address }), KNOWN_DIRECTS).ok).toBe(false);
  });

  test("a different amount is refused", () => {
    expect(checkDirectTerms(offer, accept({ amount: "1" }), KNOWN_DIRECTS).ok).toBe(false);
  });

  test("a 301-second window is refused", () => {
    expect(checkDirectTerms(offer, accept({ maxTimeoutSeconds: 301 }), KNOWN_DIRECTS).ok).toBe(false);
  });
});

describe("eip3009Payer", () => {
  test("canPay is true only for a pinned direct", () => {
    const payer = eip3009Payer(buyer);
    expect(payer.canPay(accept())).toBe(true);
    expect(payer.canPay(accept({ asset: thief.address }))).toBe(false);
    expect(payer.canPay(accept({ name: "GatewayWalletBatched" }))).toBe(false);
  });

  test("pay signs under the pinned domain even when the entry names another", async () => {
    const payer = eip3009Payer(buyer);
    const req = accept({ name: "SomethingElse", version: "9" });
    const signed = await payer.pay(req, { now: NOW, resource: RESOURCE });
    const authorization = signed.payment.payload.authorization as {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };

    expect(signed.jobId).toBe(authorization.nonce);
    expect(authorization.from).toBe(buyer.address);
    expect(authorization.to).toBe(getAddress(seller.address));
    expect(authorization.value).toBe(PRICE);
    expect(Number(authorization.validAfter)).toBe(NOW - 5);
    expect(Number(authorization.validBefore)).toBe(NOW + 120);
    expect(authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(signed.payment.resource).toEqual(RESOURCE);

    const signer = await recoverTypedDataAddress({
      domain: {
        name: DIRECT.name,
        version: DIRECT.version,
        chainId: DIRECT.chainId,
        verifyingContract: getAddress(DIRECT.asset),
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from),
        to: getAddress(authorization.to),
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature: signed.payment.payload.signature as Hex,
    });
    expect(signer).toBe(buyer.address);
  });

  test("pay caps the window at 300 seconds", async () => {
    const payer = eip3009Payer(buyer);
    const signed = await payer.pay(accept({ maxTimeoutSeconds: 600 }), { now: NOW });
    const authorization = signed.payment.payload.authorization as { validBefore: string };
    expect(Number(authorization.validBefore)).toBe(NOW + 300);
  });
});

describe("direct buy", () => {
  test("buy chooses eip3009 when it is the only option", async () => {
    const f = fresh();
    const { hub, paidPayment } = fakeHub([accept()]);
    const result = await buyOnce(f, hub, [eip3009Payer(buyer)]);

    expect(result.output).toEqual({ ok: true });
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "signed", "settled"]);
    expect(f.journal.entries().at(-1)?.rail).toBe("eip3009");
    expect(paidPayment()?.accepted.extra?.name).toBe("USDC");
  });

  test("a GatewayWalletBatched entry stays on the gateway path", async () => {
    const f = fresh();
    const { hub, paidCalls } = fakeHub([gatewayAccept()]);
    const result = await buyOnce(f, hub, [eip3009Payer(buyer), gatewayPayer(buyer)]);

    expect(result.output).toEqual({ ok: true });
    expect(f.journal.entries().at(-1)?.kind).toBe("settled");
    expect(f.journal.entries().at(-1)?.rail).toBe("gateway");
    expect(paidCalls()).toBe(1);
  });

  test("--rail eip3009 restricts the choice", async () => {
    const f = fresh();
    const { hub } = fakeHub([accept()]);
    const result = await buyOnce(f, hub, [eip3009Payer(buyer)], { rail: "eip3009" });
    expect(result.slip.body.rail).toBe("eip3009");
  });
});
