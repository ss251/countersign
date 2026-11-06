import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  PAYMENT_SIGNATURE_HEADER,
  authorizationTypedData,
  canonicalHash,
  checkCountersign,
  countersignPayload,
  fromBase64Json,
  jobIdOf,
  slipBodyFor,
  slipHash,
  slipTypedData,
  toBase64Json,
  type CountersignExtra,
  type CountersignPayload,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type Slip,
} from "@countersign/core";
import { HubClient, Journal, State, type KnownRail } from "@countersign/buyer";
import type { McpDeps } from "../src/index.ts";

export const NOW = Math.floor(Date.now() / 1000);
export const PRICE = "250000";
export const TOKEN: Address = "0x3600000000000000000000000000000000000000";
export const ESCROW: Address = "0x4444444444444444444444444444444444444444";

export const seller = privateKeyToAccount(generatePrivateKey());
export const buyer = privateKeyToAccount(generatePrivateKey());

export const TEST_RAIL: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "https://rpc.testnet.arc.network",
};

export const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "echoes the input back",
  adapter: "skill",
  input: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
  output: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
export const OFFER_HASH = canonicalHash(offer);

export const otherOffer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Weather",
  summary: "a forecast for one city",
  adapter: "openapi",
  input: { type: "object" },
  output: { type: "object" },
  price: "500000",
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
export const OTHER_HASH = canonicalHash(otherOffer);

const extra: CountersignExtra = {
  rail: "escrow",
  escrow: ESCROW,
  chainId: 5042002,
  offerHash: OFFER_HASH,
  deadlineSeconds: 120,
  tokenName: "USDC",
  tokenVersion: "2",
};

const accepts = [
  {
    scheme: "countersign",
    network: "eip155:5042002",
    amount: PRICE,
    asset: TOKEN,
    payTo: seller.address,
    maxTimeoutSeconds: 120,
    extra,
  },
];

export const hubState = { unpaid: 0, paid: 0 };
export const slips = new Map<string, Slip>();

async function makeSlip(payment: PaymentPayload, input: unknown, output: unknown): Promise<Slip> {
  const payload = payment.payload as unknown as CountersignPayload;
  const body = slipBodyFor(
    {
      jobId: payload.authorization.nonce,
      offerHash: OFFER_HASH,
      input,
      rail: "escrow",
      network: "eip155:5042002",
      buyer: payload.terms.buyer,
      payTo: seller.address,
      asset: TOKEN,
      amount: PRICE,
      deadline: payload.terms.deadline,
      escrow: ESCROW,
      chainId: 5042002,
      lineage: [],
    },
    seller.address,
    canonicalHash(input),
    canonicalHash(output),
    1000,
  );
  const sellerSig = await seller.signTypedData(slipTypedData(body));
  return {
    body,
    hash: slipHash(body),
    sellerSig,
    payment,
    settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
  };
}

/** A slip fixture shaped the way packages/verify's own tests build one. */
export async function makeVerifySlip(): Promise<Slip> {
  const offerHash = canonicalHash({ offer: "mcp-fixture" });
  const terms = {
    offerHash,
    buyer: buyer.address,
    payee: seller.address,
    amount: "10000",
    deadline: 1_762_400_300,
    salt: "9",
  };
  const input = {
    terms,
    chainId: 5042002,
    escrow: ESCROW,
    token: TOKEN,
    tokenName: "USDC",
    tokenVersion: "2",
    validAfter: 0,
    validBefore: 1_762_400_600,
  };
  const payload = countersignPayload(input, await buyer.signTypedData(authorizationTypedData(input)));
  const jobId = jobIdOf(terms, 5042002, ESCROW);
  const body = slipBodyFor(
    {
      jobId,
      offerHash: offerHash as Hex,
      input: { q: 1 },
      rail: "escrow",
      network: "eip155:5042002",
      buyer: buyer.address,
      payTo: seller.address,
      asset: TOKEN,
      amount: "10000",
      deadline: terms.deadline,
      escrow: ESCROW,
      chainId: 5042002,
      lineage: [],
    },
    seller.address,
    canonicalHash({ q: 1 }),
    canonicalHash({ a: 2 }),
    1_762_400_100,
  );
  return {
    body,
    hash: slipHash(body),
    sellerSig: await seller.signTypedData(slipTypedData(body)),
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:5042002",
        amount: "10000",
        asset: TOKEN,
        payTo: seller.address,
        maxTimeoutSeconds: 120,
        extra: {
          rail: "escrow",
          escrow: ESCROW,
          chainId: 5042002,
          offerHash,
          deadlineSeconds: 120,
          tokenName: "USDC",
          tokenVersion: "2",
        },
      },
      payload: payload as unknown as Record<string, unknown>,
    },
    settlement: { transaction: "0xabc", network: "eip155:5042002" },
  };
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const listing = (entry: Offer, offerHash: Hex) => ({ offerHash, offer: entry, online: true, status: "listed" });

    if (req.method === "GET" && url.pathname === "/offers") {
      return Response.json({ offers: [listing(offer, OFFER_HASH), listing(otherOffer, OTHER_HASH)] });
    }
    const path = url.pathname.toLowerCase();
    if (req.method === "GET" && path === `/offers/${OFFER_HASH}`) {
      return Response.json(listing(offer, OFFER_HASH));
    }
    if (req.method === "GET" && path === `/offers/${OTHER_HASH}`) {
      return Response.json(listing(otherOffer, OTHER_HASH));
    }
    if (req.method === "GET" && url.pathname.startsWith("/slips/")) {
      const slip = slips.get(url.pathname.slice(7));
      return slip ? Response.json(slip) : new Response("{}", { status: 404 });
    }
    if (req.method === "POST" && url.pathname === `/offers/${OFFER_HASH}/call`) {
      const body = (await req.json()) as { input: { q: string } };
      const header = req.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!header) {
        hubState.unpaid += 1;
        return Response.json({ x402Version: 2, resource: { url: req.url }, accepts }, { status: 402 });
      }
      hubState.paid += 1;
      const payment = fromBase64Json<PaymentPayload>(header);
      const check = await checkCountersign(payment.payload as unknown as CountersignPayload, {
        chainId: 5042002,
        escrow: ESCROW,
        token: TOKEN,
        tokenName: "USDC",
        tokenVersion: "2",
        now: NOW,
      });
      if (!check.ok) return Response.json({ code: "bad-payment", message: check.message }, { status: 400 });
      const output = { a: body.input.q };
      const slip = await makeSlip(payment, body.input, output);
      slips.set(slip.hash, slip);
      return new Response(JSON.stringify({ output, slip }), {
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": toBase64Json({
            success: true,
            transaction: slip.settlement.transaction,
            network: "eip155:5042002",
          }),
        },
      });
    }
    return new Response("{}", { status: 404 });
  },
});

export const HUB_URL = `http://127.0.0.1:${server.port}`;
export const hub = new HubClient(HUB_URL);

export function stopHub(): void {
  server.stop(true);
}

export function freshState(over: Partial<Envelope> = {}): State {
  const state = new State(mkdtempSync(join(tmpdir(), "cs-mcp-")));
  state.saveEnvelope({
    v: 1,
    agent: buyer.address,
    cap: "5000000",
    perMerchant: "5000000",
    allowlist: [],
    revoked: false,
    ...over,
  });
  writeFileSync(state.railsPath, `${JSON.stringify([TEST_RAIL])}\n`);
  return state;
}

export function depsFor(
  over: { account?: LocalAccount | null; envelope?: Partial<Envelope> } = {},
): McpDeps {
  const state = freshState(over.envelope);
  return {
    hub,
    state,
    journal: new Journal(state.journalPath),
    now: () => NOW,
    hubUrl: HUB_URL,
    ...(over.account === null ? {} : { account: over.account ?? buyer }),
  };
}

/** A buyer account whose signing methods count and fail if the refusal lets one through. */
export function spyAccount(): { account: LocalAccount; signatures: () => number } {
  const base = privateKeyToAccount(generatePrivateKey());
  let calls = 0;
  const account: LocalAccount = {
    ...base,
    signMessage: async () => {
      calls += 1;
      throw new Error("signMessage must not be called");
    },
    signTypedData: async () => {
      calls += 1;
      throw new Error("signTypedData must not be called");
    },
  };
  return { account, signatures: () => calls };
}
