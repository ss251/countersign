import { describe, expect, test } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import {
  AccountCreateTransaction,
  AccountId,
  Hbar,
  TokenAssociateTransaction,
  TokenId,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import type { Facilitator } from "../facilitator.ts";
import {
  checkTransfer,
  decodeTransfer,
  InspectError,
  type ExpectedTransfer,
  type InspectedTransfer,
  type TransferCheck,
} from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import { createHederaRail, type HederaRailOptions } from "../rail.ts";
import {
  FALLBACK_FEE_PAYER,
  FEE_PAYER,
  NODE,
  OFFER_HASH,
  PAYEE,
  PAYER,
  offer,
  payerKey,
  transfer,
  type Build,
} from "./fixtures.ts";

interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  bigintBelow(maxExclusive: bigint): bigint;
}

function prng(seed: number): Rng {
  let a = seed >>> 0;
  function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }
  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor((next() / 0x1_0000_0000) * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor((next() / 0x1_0000_0000) * items.length)]!;
    },
    bigintBelow(maxExclusive: bigint): bigint {
      return ((BigInt(next()) << 32n) | BigInt(next())) % maxExclusive;
    },
  };
}

const WANT: ExpectedTransfer = {
  asset: USDC_TESTNET,
  amount: 10_000n,
  payTo: PAYEE,
  feePayer: FEE_PAYER,
  offerHash: OFFER_HASH,
  maxTimeoutSeconds: 120,
};
const MEMO = offerMemo(OFFER_HASH);
const NOW = () => Math.floor(Date.now() / 1000);
const PADS = [" ", "\t", "\n", "\r", "\0", ".", "0", "a", "-", "\u00a0", "\u2028"] as const;
const ctx = { resource: "http://hub.test/offers/fuzz/call", now: 1793957000 };

function randomAccount(rng: Rng, exclude: readonly string[] = []): string {
  for (;;) {
    const id = `0.0.${1 + rng.int(1_000_000_000)}`;
    if (!exclude.includes(id)) return id;
  }
}

function randomToken(rng: Rng, exclude: readonly string[] = []): string {
  for (;;) {
    const id = `0.0.${1 + rng.int(1_000_000_000)}`;
    if (!exclude.includes(id)) return id;
  }
}

function randomHash(rng: Rng): string {
  let hex = "0x";
  for (let i = 0; i < 8; i++) hex += rng.next().toString(16).padStart(8, "0");
  return hex;
}

function randomAmount(rng: Rng): bigint {
  return 1n + rng.bigintBelow(1_000_000_000_000_000n);
}

function capture(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function wantFrom(req: PaymentRequirements): ExpectedTransfer {
  return {
    asset: req.asset,
    amount: BigInt(req.amount),
    payTo: req.payTo,
    feePayer: req.extra!.feePayer as string,
    offerHash: req.extra!.offerHash as string,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
  };
}

async function transferWithDuration(want: ExpectedTransfer, seconds: number): Promise<string> {
  const token = TokenId.fromString(want.asset);
  const tx = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(PAYER), -want.amount)
    .addTokenTransfer(token, AccountId.fromString(want.payTo), want.amount)
    .setTransactionId(TransactionId.generate(AccountId.fromString(want.feePayer)))
    .setTransactionMemo(offerMemo(want.offerHash))
    .setTransactionValidDuration(seconds)
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

interface FakeOpts {
  name?: string;
  feePayer?: string | null;
  verify?: "ok" | "refuse" | "throw";
  settle?: "ok" | "refuse" | "throw";
}

function fakeFacilitator(o: FakeOpts = {}) {
  const calls = { feePayer: 0, verify: 0, settle: 0 };
  const f: Facilitator = {
    name: o.name ?? "fake",
    async feePayer() {
      calls.feePayer++;
      return o.feePayer === undefined ? FEE_PAYER : o.feePayer;
    },
    async verify() {
      calls.verify++;
      if (o.verify === "throw") throw new Error("down");
      return o.verify === "refuse"
        ? { isValid: false, invalidReason: "insufficient_funds" }
        : { isValid: true, payer: PAYER };
    },
    async settle(p) {
      calls.settle++;
      if (o.settle === "throw") throw new Error("down");
      if (o.settle === "refuse") {
        return { success: false, errorReason: "transaction_failed", transaction: "", network: "hedera:testnet" as const };
      }
      const id = decodeTransfer(p.payload.transaction as string).transactionId;
      return { success: true, transaction: id, network: "hedera:testnet" as const, payer: PAYER };
    },
  };
  return { f, calls };
}

function countingMirror(counter: { fetch: number }) {
  return {
    base: "http://mirror.test",
    fetch: (async () => {
      counter.fetch++;
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch,
  };
}

async function rail(facilitators: Facilitator[], over: Partial<HederaRailOptions> = {}) {
  return createHederaRail({
    facilitators,
    refreshEveryMs: 0,
    verifyPayerSignature: async () => ({ ok: true }),
    confirmTimeoutMs: 20,
    ...over,
  });
}

async function pay(req: PaymentRequirements, over: Build = {}): Promise<PaymentPayload> {
  const t = await transfer({
    amount: BigInt(req.amount),
    to: req.payTo,
    feePayer: req.extra!.feePayer as string,
    memo: offerMemo(req.extra!.offerHash as string),
    ...over,
  });
  return { x402Version: 2, accepted: req, payload: { transaction: t.base64 } };
}

const MUTATIONS = [
  "amount-plus",
  "amount-minus",
  "payee",
  "token",
  "fee-payer",
  "memo-other",
  "memo-truncated",
  "memo-uppercased",
  "memo-padded",
  "memo-empty",
  "extra-token-same",
  "extra-token-other",
  "hbar",
  "split-three",
  "payer-fee-payer",
  "payer-payee",
  "unsigned",
  "expired-past",
  "expired-boundary",
  "not-yet-valid",
  "validity-too-long",
] as const;

type Mutation = (typeof MUTATIONS)[number];

interface MutationResult {
  base64: string;
  inspected: InspectedTransfer;
  check: TransferCheck;
  detail: string;
}

async function mutate(rng: Rng, kind: Mutation, want: ExpectedTransfer, i: number): Promise<MutationResult> {
  let build: Build = {};
  let raw: string | undefined;
  let at: ((t: InspectedTransfer) => number) | undefined;
  switch (kind) {
    case "amount-plus":
      build = { amount: want.amount + 1n + rng.bigintBelow(1_000_000n) };
      break;
    case "amount-minus":
      build = { amount: want.amount - (1n + rng.bigintBelow(want.amount - 1n)) };
      break;
    case "payee":
      build = { to: randomAccount(rng, [PAYEE, PAYER, FEE_PAYER]) };
      break;
    case "token":
      build = { asset: randomToken(rng, [USDC_TESTNET]) };
      break;
    case "fee-payer":
      build = { feePayer: randomAccount(rng, [FEE_PAYER, PAYEE, PAYER]) };
      break;
    case "memo-other":
      build = { memo: offerMemo(randomHash(rng)) };
      break;
    case "memo-truncated":
      build = { memo: MEMO.slice(0, 3 + rng.int(65)) };
      break;
    case "memo-uppercased":
      build = { memo: MEMO.toUpperCase() };
      break;
    case "memo-padded":
      build = { memo: MEMO + rng.pick(PADS) };
      break;
    case "memo-empty":
      build = { memo: "" };
      break;
    case "extra-token-same":
      build = {
        extraTokens: [{ account: randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]), amount: 1n + rng.bigintBelow(1_000n) }],
      };
      break;
    case "extra-token-other": {
      const token = randomToken(rng, [USDC_TESTNET]);
      build = {
        extraTokens: [
          { account: randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]), amount: 1n + rng.bigintBelow(1_000n), token },
          { account: randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]), amount: -(1n + rng.bigintBelow(1_000n)), token },
        ],
      };
      break;
    }
    case "hbar": {
      const first = randomAccount(rng, [FEE_PAYER]);
      build = {
        hbar: [
          { account: first, tinybars: -(1n + rng.bigintBelow(1_000n)) },
          { account: randomAccount(rng, [first, FEE_PAYER]), tinybars: 1n + rng.bigintBelow(1_000n) },
        ],
      };
      break;
    }
    case "split-three": {
      const third = randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]);
      const k = 1n + rng.bigintBelow(want.amount - 1n);
      build = {
        amount: want.amount,
        extraTokens: [
          { account: third, amount: -k },
          { account: PAYEE, amount: -1n },
        ],
      };
      break;
    }
    case "payer-fee-payer":
      build = { from: FEE_PAYER };
      break;
    case "payer-payee":
      build = { from: PAYEE };
      break;
    case "unsigned":
      build = { sign: false };
      break;
    case "expired-past":
      build = { startOffset: -(1_000 + rng.int(10_000)) };
      break;
    case "expired-boundary":
      at = (t) => t.validStart + t.validDurationSeconds + (i % 2 === 0 ? 0 : rng.int(10_000));
      break;
    case "not-yet-valid":
      build = { startOffset: 60 + rng.int(10_000) };
      break;
    case "validity-too-long":
      raw = await transferWithDuration(want, want.maxTimeoutSeconds + 1);
      break;
  }
  const base64 = raw ?? (await transfer(build)).base64;
  const inspected = decodeTransfer(base64);
  const check = checkTransfer(inspected, want, at ? at(inspected) : NOW());
  const tokens = Object.entries(inspected.tokens)
    .map(([token, entries]) => `${token}=[${entries.map((e) => `${e.account}:${e.amount}`).join(",")}]`)
    .join(" ");
  const detail = `feePayer=${inspected.feePayer} memo=${JSON.stringify(inspected.memo)} tokens=${tokens} hbar=${inspected.hbar.length} nft=${inspected.nftCount} signers=${inspected.signerCount} window=${inspected.validStart}+${inspected.validDurationSeconds}`;
  return { base64, inspected, check, detail };
}

async function nonTransfer(rng: Rng, i: number): Promise<string> {
  let tx: Transaction;
  switch (i % 4) {
    case 0:
      tx = new TopicMessageSubmitTransaction()
        .setTopicId(`0.0.${1 + rng.int(1_000_000)}`)
        .setMessage(`fuzz-${rng.next()}`);
      break;
    case 1:
      tx = new AccountCreateTransaction()
        .setKey(payerKey.publicKey)
        .setInitialBalance(Hbar.fromTinybars(1 + rng.int(1_000_000)));
      break;
    case 2:
      tx = new TokenAssociateTransaction()
        .setAccountId(AccountId.fromString(PAYER))
        .setTokenIds([TokenId.fromString(`0.0.${1 + rng.int(1_000_000)}`)]);
      break;
    default:
      tx = new TopicCreateTransaction().setTopicMemo(`fuzz-topic-${rng.next()}`);
      break;
  }
  tx.setTransactionId(TransactionId.generate(FEE_PAYER)).setNodeAccountIds([NODE]).freeze();
  await tx.sign(payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

describe("hedera rail fuzz", () => {
  const SEED_P1 = 0x51ee_1001;
  test(`property 1: every listed single-field mutation except payer is refused (seed 0x${SEED_P1.toString(16)})`, async () => {
    const rng = prng(SEED_P1);
    const accepted: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const kind = MUTATIONS[i % MUTATIONS.length]!;
      const m = await mutate(rng, kind, WANT, i);
      if (m.check.ok) accepted.push(`${kind}: ${m.detail}`);
    }
    expect({ cases, accepted: accepted.length, examples: accepted.slice(0, 5) }).toEqual({
      cases,
      accepted: 0,
      examples: [],
    });
  }, 20_000);

  const SEED_PAYER = 0x51ee_1002;
  test(`property 1: a changed payer account is refused by verify and settle (seed 0x${SEED_PAYER.toString(16)})`, async () => {
    const rng = prng(SEED_PAYER);
    const { f, calls } = fakeFacilitator({ name: "payer", feePayer: FEE_PAYER });
    const r = await rail([f], { verifyPayerSignature: async ({ payer }) => ({ ok: payer === PAYER }) });
    const req = r.challenge(offer(), ctx);
    const bad: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const from = randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]);
      const payment = await pay(req, { from });
      const v = await r.verify(payment, req);
      const s = await r.settle(payment, req);
      if (v.isValid || v.invalidReason !== "signature_invalid") {
        bad.push(`from=${from} -> verify ${JSON.stringify(v)}`);
      }
      if (s.success || s.errorReason !== "signature_invalid") {
        bad.push(`from=${from} -> settle ${JSON.stringify(s)}`);
      }
    }
    expect({
      cases,
      bad: bad.length,
      examples: bad.slice(0, 5),
      facilitator: { verify: calls.verify, settle: calls.settle },
    }).toEqual({ cases, bad: 0, examples: [], facilitator: { verify: 0, settle: 0 } });
  }, 20_000);

  const SEED_SIG = 0x51ee_1003;
  test(`a changed payer without its signature is refused by verify before the facilitator (seed 0x${SEED_SIG.toString(16)})`, async () => {
    const rng = prng(SEED_SIG);
    const { f, calls } = fakeFacilitator({ name: "sig", feePayer: FEE_PAYER });
    const r = await rail([f], { verifyPayerSignature: async ({ payer }) => ({ ok: payer === PAYER }) });
    const req = r.challenge(offer(), ctx);
    const bad: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const from = randomAccount(rng, [PAYER, PAYEE, FEE_PAYER]);
      const payment = await pay(req, { from });
      const res = await r.verify(payment, req);
      if (res.isValid || res.invalidReason !== "signature_invalid") {
        bad.push(`from=${from} -> ${JSON.stringify(res)}`);
      }
    }
    expect({ cases, bad: bad.length, examples: bad.slice(0, 5), facilitatorVerify: calls.verify }).toEqual({
      cases,
      bad: 0,
      examples: [],
      facilitatorVerify: 0,
    });
  }, 20_000);

  const SEED_P2 = 0x51ee_2001;
  test(`property 2: random valid payments are accepted and name the debited payer (seed 0x${SEED_P2.toString(16)})`, async () => {
    const rng = prng(SEED_P2);
    const failures: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const amount = randomAmount(rng);
      const asset = randomToken(rng);
      const from = randomAccount(rng);
      const to = randomAccount(rng, [from]);
      const feePayer = randomAccount(rng, [from, to]);
      const hash = randomHash(rng);
      const want: ExpectedTransfer = { asset, amount, payTo: to, feePayer, offerHash: hash, maxTimeoutSeconds: 180 };
      const t = await transfer({ from, to, amount, asset, feePayer, memo: offerMemo(hash) });
      const inspected = decodeTransfer(t.base64);
      const check = checkTransfer(inspected, want, NOW());
      const expectedPayer = AccountId.fromString(from).toString();
      if (!check.ok) {
        failures.push(`amount=${amount} asset=${asset} from=${from} to=${to} feePayer=${feePayer}: ${check.reason}`);
      } else if (check.payer !== expectedPayer) {
        failures.push(`from=${from} -> payer=${check.payer} not ${expectedPayer}`);
      }
    }
    expect({ cases, failures: failures.length, examples: failures.slice(0, 5) }).toEqual({
      cases,
      failures: 0,
      examples: [],
    });
  }, 20_000);

  const SEED_P3 = 0x51ee_3001;
  test(`property 3: check-refused payments never reach a facilitator (seed 0x${SEED_P3.toString(16)})`, async () => {
    const rng = prng(SEED_P3);
    const a = fakeFacilitator({ name: "a", feePayer: FEE_PAYER });
    const b = fakeFacilitator({ name: "b", feePayer: FALLBACK_FEE_PAYER });
    const mirror = { fetch: 0 };
    const r = await rail([a.f, b.f], { mirror: countingMirror(mirror) });
    const req = r.challenge(offer(), ctx);
    const want = wantFrom(req);
    const kinds = MUTATIONS.filter((k) => k !== "expired-boundary");
    const leaked: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const kind = kinds[i % kinds.length]!;
      const m = await mutate(rng, kind, want, i);
      if (m.check.ok) {
        leaked.push(`${kind}: checkTransfer accepted: ${m.detail}`);
        continue;
      }
      const payment: PaymentPayload = { x402Version: 2, accepted: req, payload: { transaction: m.base64 } };
      const v = await r.verify(payment, req);
      const s = await r.settle(payment, req);
      if (v.isValid || s.success) leaked.push(`${kind}: rail accepted: verify=${JSON.stringify(v)} settle=${JSON.stringify(s)}`);
    }
    expect({
      cases,
      leaked: leaked.length,
      examples: leaked.slice(0, 5),
      facilitator: { verify: a.calls.verify + b.calls.verify, settle: a.calls.settle + b.calls.settle },
      mirror: mirror.fetch,
    }).toEqual({
      cases,
      leaked: 0,
      examples: [],
      facilitator: { verify: 0, settle: 0 },
      mirror: 0,
    });
  }, 20_000);

  const SEED_P4 = 0x51ee_4001;
  test(`property 4: one changed requirement field is refused (seed 0x${SEED_P4.toString(16)})`, async () => {
    const rng = prng(SEED_P4);
    const a = fakeFacilitator({ name: "a", feePayer: FEE_PAYER });
    const b = fakeFacilitator({ name: "b", feePayer: FALLBACK_FEE_PAYER });
    const r = await rail([a.f, b.f]);
    const req = r.challenge(offer(), ctx);
    const payment = await pay(req);
    const fields = ["amount", "asset", "payTo", "network", "scheme", "maxTimeoutSeconds", "extra.offerHash"] as const;
    const failures: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const field = fields[i % fields.length]!;
      const side = i % 2 === 0 ? "accepted" : "requirements";
      const changed = changeRequirement(req, field, rng);
      const p = side === "accepted" ? { ...payment, accepted: changed } : payment;
      const q = side === "requirements" ? changed : req;
      const res = await r.verify(p, q);
      if (res.isValid) failures.push(`${side}.${field} -> ${JSON.stringify(res)}`);
    }
    expect({
      cases,
      failures: failures.length,
      examples: failures.slice(0, 5),
      facilitatorVerify: a.calls.verify + b.calls.verify,
    }).toEqual({ cases, failures: 0, examples: [], facilitatorVerify: 0 });
  }, 20_000);

  const SEED_FP = 0x51ee_4002;
  test(`property 4: another known fee payer is allowed, an unknown one is refused (seed 0x${SEED_FP.toString(16)})`, async () => {
    const rng = prng(SEED_FP);
    const a = fakeFacilitator({ name: "a", feePayer: FEE_PAYER });
    const b = fakeFacilitator({ name: "b", feePayer: FALLBACK_FEE_PAYER });
    const r = await rail([a.f, b.f]);
    const req = r.challenge(offer(), ctx);
    const known = [FEE_PAYER, FALLBACK_FEE_PAYER];
    const otherKnown = req.extra!.feePayer === FEE_PAYER ? FALLBACK_FEE_PAYER : FEE_PAYER;
    const bad: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const useKnown = i % 2 === 0;
      const feePayer = useKnown ? otherKnown : randomAccount(rng, known);
      const offered: PaymentRequirements = { ...req, extra: { ...req.extra, feePayer } };
      const payment = await pay(offered);
      const res = await r.verify(payment, req);
      if (useKnown) {
        if (!res.isValid || res.payer !== PAYER) bad.push(`known ${feePayer} -> ${JSON.stringify(res)}`);
      } else if (res.isValid || res.invalidReason !== "unknown_fee_payer") {
        bad.push(`unknown ${feePayer} -> ${JSON.stringify(res)}`);
      }
    }
    expect({ cases, bad: bad.length, examples: bad.slice(0, 5) }).toEqual({ cases, bad: 0, examples: [] });
  }, 20_000);

  const SEED_P5A = 0x51ee_5001;
  test(`property 5: random bytes throw InspectError (seed 0x${SEED_P5A.toString(16)})`, () => {
    const rng = prng(SEED_P5A);
    const escapes: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const len = rng.int(257);
      const bytes = Buffer.alloc(len);
      for (let j = 0; j < len; j++) bytes[j] = rng.int(256);
      const err = capture(() => decodeTransfer(bytes.toString("base64")));
      if (!(err instanceof InspectError)) escapes.push(`len=${len} ${describeError(err)}`);
    }
    expect({ cases, escapes: escapes.length, examples: escapes.slice(0, 5) }).toEqual({
      cases,
      escapes: 0,
      examples: [],
    });
  }, 20_000);

  const SEED_P5B = 0x51ee_5002;
  test(`property 5: truncated real transactions throw InspectError (seed 0x${SEED_P5B.toString(16)})`, async () => {
    const rng = prng(SEED_P5B);
    const escapes: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const t = await transfer({ amount: BigInt(1 + i) });
      const bytes = Buffer.from(t.base64, "base64");
      const cut = rng.int(bytes.length);
      const err = capture(() => decodeTransfer(bytes.subarray(0, cut).toString("base64")));
      if (!(err instanceof InspectError)) escapes.push(`cut=${cut}/${bytes.length} ${describeError(err)}`);
    }
    expect({ cases, escapes: escapes.length, examples: escapes.slice(0, 5) }).toEqual({
      cases,
      escapes: 0,
      examples: [],
    });
  }, 20_000);

  const SEED_P5C = 0x51ee_5003;
  test(`property 5: non-transfer transactions throw InspectError (seed 0x${SEED_P5C.toString(16)})`, async () => {
    const rng = prng(SEED_P5C);
    const escapes: string[] = [];
    const cases = 320;
    for (let i = 0; i < cases; i++) {
      const b64 = await nonTransfer(rng, i);
      const err = capture(() => decodeTransfer(b64));
      if (!(err instanceof InspectError)) escapes.push(`kind=${i % 4} ${describeError(err)}`);
    }
    expect({ cases, escapes: escapes.length, examples: escapes.slice(0, 5) }).toEqual({
      cases,
      escapes: 0,
      examples: [],
    });
  }, 20_000);
});

type Field = "amount" | "asset" | "payTo" | "network" | "scheme" | "maxTimeoutSeconds" | "extra.offerHash";

function changeRequirement(req: PaymentRequirements, field: Field, rng: Rng): PaymentRequirements {
  const q = JSON.parse(JSON.stringify(req)) as PaymentRequirements;
  switch (field) {
    case "amount":
      q.amount = (BigInt(req.amount) + 1n + rng.bigintBelow(1_000_000n)).toString();
      break;
    case "asset":
      q.asset = randomToken(rng, [req.asset]);
      break;
    case "payTo":
      q.payTo = randomAccount(rng, [req.payTo]);
      break;
    case "network":
      q.network = "hedera:mainnet";
      break;
    case "scheme":
      q.scheme = "countersign";
      break;
    case "maxTimeoutSeconds":
      for (;;) {
        const next = 1 + rng.int(10_000);
        if (next !== req.maxTimeoutSeconds) {
          q.maxTimeoutSeconds = next;
          break;
        }
      }
      break;
    case "extra.offerHash":
      for (;;) {
        const next = randomHash(rng);
        if (next !== req.extra?.offerHash) {
          q.extra = { ...q.extra, offerHash: next };
          break;
        }
      }
      break;
  }
  return q;
}
