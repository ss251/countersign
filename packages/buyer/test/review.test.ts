import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  acceptTypedData,
  authorizationTypedData,
  canonicalHash,
  countersignPayload,
  disputeTypedData,
  jobIdOf,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type CountersignTerms,
  type Slip,
} from "@countersign/core";
import { HubClient, Journal, ReviewError, State, acceptJob, disputeJob, resume, type JobReader, type KnownRail } from "../src/index.ts";

const buyer = privateKeyToAccount(generatePrivateKey());
const seller = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW_A: Address = "0x4444444444444444444444444444444444444444";
const ESCROW_B: Address = "0x5555555555555555555555555555555555555555";
const rail = (escrow: Address): KnownRail => ({
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "http://127.0.0.1:1",
});
const RAIL_A = rail(ESCROW_A);
const RAIL_B = rail(ESCROW_B);
const OFFER: Hex = `0x${"11".repeat(32)}`;

const terms: CountersignTerms = {
  offerHash: OFFER,
  buyer: buyer.address,
  payee: seller.address,
  amount: "1000",
  deadline: 2_000_000_000,
  salt: "7",
};

/** A slip as the buyer saves it after a paid call: a real countersignature and a seller-signed body. */
async function makeSlip(escrow: Address, signer = seller, over: { buyer?: Address } = {}): Promise<Slip> {
  const input = { terms, chainId: 5042002, escrow, token: TOKEN, tokenName: "USDC", tokenVersion: "2", validAfter: 0, validBefore: 1_999_999_999 };
  const payload = countersignPayload(input, await buyer.signTypedData(authorizationTypedData(input)));
  const jobId = jobIdOf(terms, 5042002, escrow);
  const body = slipBodyFor(
    {
      jobId,
      offerHash: OFFER,
      input: {},
      rail: "escrow",
      network: "eip155:5042002",
      buyer: over.buyer ?? buyer.address,
      payTo: seller.address,
      asset: TOKEN,
      amount: "1000",
      deadline: terms.deadline,
      escrow,
      chainId: 5042002,
      lineage: [],
    },
    seller.address,
    canonicalHash({}),
    canonicalHash({ a: 1 }),
    1000,
  );
  const sellerSig = await signer.signTypedData(slipTypedData(body));
  return {
    body,
    hash: slipHash(body),
    sellerSig,
    payment: { x402Version: 2, accepted: {} as never, payload: payload as never },
    settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
  };
}

// A hub that records what the buyer posts, and can be told to refuse.
const posts: Array<{ path: string; sig: Hex }> = [];
let hubRefuses = false;
let hubJob: { status: string; closeTx?: string } = { status: "in_review" };
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && /^\/jobs\/0x[0-9a-f]{64}\/(accept|dispute)$/.test(url.pathname)) {
      if (hubRefuses) return Response.json({ code: "nope", message: "Refused. The hub would not relay it." }, { status: 409 });
      posts.push({ path: url.pathname, sig: ((await req.json()) as { sig: Hex }).sig });
      return Response.json({ ok: true });
    }
    if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
      return Response.json({ jobId: url.pathname.slice(6), offerHash: OFFER, rail: "escrow", deadline: 0, slipHash: null, ...hubJob });
    }
    return new Response("{}", { status: 404 });
  },
});
afterAll(() => server.stop(true));
const hub = new HubClient(`http://127.0.0.1:${server.port}`);

function fresh() {
  const state = new State(mkdtempSync(join(tmpdir(), "cs-review-")));
  return { state, journal: new Journal(state.journalPath) };
}

/** Journal lines as buy() writes them; `escrow` is omitted to stand for lines written before it was recorded. */
function paid(f: ReturnType<typeof fresh>, jobId: Hex, extra: { escrow?: Address; slip?: Slip } = {}) {
  const base = { at: 1, offerHash: OFFER, seller: seller.address, amount: "1000", network: "eip155:5042002" as const, rail: "escrow" as const, jobId };
  f.journal.append({ ...base, kind: "countersigned", reservationId: "r1" });
  f.journal.append({ ...base, kind: "signed", reservationId: "r1", ...(extra.escrow ? { escrow: extra.escrow, chainId: 5042002 } : {}) });
  if (extra.slip) {
    f.state.saveSlip(extra.slip);
    f.journal.append({ ...base, kind: "released", slipHash: extra.slip.hash });
  }
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    expect(e).toBeInstanceOf(ReviewError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  posts.length = 0;
  hubRefuses = false;
  hubJob = { status: "in_review" };
});

describe("accept", () => {
  test("signs Accept for the held slip under the pinned escrow, and the hub gets it", async () => {
    const f = fresh();
    const slip = await makeSlip(ESCROW_A);
    const jobId = slip.body.jobId;
    paid(f, jobId, { slip });

    const done = await acceptJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A, RAIL_B] });
    expect(done.escrow).toBe(ESCROW_A);
    expect(posts).toEqual([{ path: `/jobs/${jobId}/accept`, sig: done.signature }]);
    const td = acceptTypedData(5042002, ESCROW_A, jobId, slip.hash);
    expect(await recoverTypedDataAddress({ ...td, signature: done.signature })).toBe(buyer.address);
    expect(f.journal.entries().at(-1)).toMatchObject({ kind: "accepted", jobId, slipHash: slip.hash });
  });

  test("refuses, posting nothing, when the agent holds no slip for the job", async () => {
    const f = fresh();
    const jobId = jobIdOf(terms, 5042002, ESCROW_A);
    paid(f, jobId, { escrow: ESCROW_A });
    expect(await refusal(() => acceptJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A] }))).toContain("no slip");
    expect(posts).toHaveLength(0);
  });

  test("refuses a slip whose escrow is not pinned", async () => {
    const f = fresh();
    const slip = await makeSlip(ESCROW_B);
    paid(f, slip.body.jobId, { slip });
    const message = await refusal(() => acceptJob({ hub, ...f, signer: buyer, jobId: slip.body.jobId, now: 5, known: [RAIL_A] }));
    expect(message).toContain("not one this agent pins");
    expect(posts).toHaveLength(0);
  });

  test("refuses a tampered slip, a slip signed by someone else, and a slip for another buyer", async () => {
    const tampered = await makeSlip(ESCROW_A);
    tampered.body = { ...tampered.body, amount: "999" };
    const forged = await makeSlip(ESCROW_A, stranger);
    const notMine = await makeSlip(ESCROW_A, seller, { buyer: stranger.address });
    for (const [slip, why] of [
      [tampered, "hash does not match"],
      [forged, "not signed by its seller"],
      [notMine, "another buyer"],
    ] as const) {
      const f = fresh();
      paid(f, slip.body.jobId, { slip });
      expect(await refusal(() => acceptJob({ hub, ...f, signer: buyer, jobId: slip.body.jobId, now: 5, known: [RAIL_A] }))).toContain(why);
    }
    expect(posts).toHaveLength(0);
  });

  test("refuses a slip that names a pinned escrow its countersignature was not made for", async () => {
    // The seller signs a slip naming escrow B for a job whose countersignature binds escrow A.
    const real = await makeSlip(ESCROW_A);
    const body = { ...real.body, escrow: ESCROW_B };
    const slip: Slip = { ...real, body, hash: slipHash(body), sellerSig: await seller.signTypedData(slipTypedData(body)) };
    const f = fresh();
    paid(f, body.jobId, { slip });
    const message = await refusal(() => acceptJob({ hub, ...f, signer: buyer, jobId: body.jobId, now: 5, known: [RAIL_A, RAIL_B] }));
    expect(message).toContain("do not derive this job");
    expect(posts).toHaveLength(0);
  });

  test("a hub that will not relay leaves no accepted line in the journal", async () => {
    const f = fresh();
    const slip = await makeSlip(ESCROW_A);
    paid(f, slip.body.jobId, { slip });
    hubRefuses = true;
    await expect(acceptJob({ hub, ...f, signer: buyer, jobId: slip.body.jobId, now: 5, known: [RAIL_A] })).rejects.toThrow(
      "would not relay",
    );
    expect(f.journal.entries().some((e) => e.kind === "accepted")).toBe(false);
  });
});

describe("dispute", () => {
  const jobId = jobIdOf(terms, 5042002, ESCROW_A);

  test("signs Dispute under the escrow the journal recorded", async () => {
    const f = fresh();
    paid(f, jobId, { escrow: ESCROW_A });
    const done = await disputeJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A, RAIL_B] });
    expect(posts).toEqual([{ path: `/jobs/${jobId}/dispute`, sig: done.signature }]);
    const td = disputeTypedData(5042002, ESCROW_A, jobId, 1);
    expect(await recoverTypedDataAddress({ ...td, signature: done.signature })).toBe(buyer.address);
    expect(f.journal.entries().at(-1)?.kind).toBe("disputed");
  });

  test("refuses when the recorded escrow is not pinned, or the job is not in the journal", async () => {
    const f = fresh();
    paid(f, jobId, { escrow: ESCROW_B });
    expect(await refusal(() => disputeJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A] }))).toContain("not one this agent pins");
    expect(await refusal(() => disputeJob({ hub, ...fresh(), signer: buyer, jobId, now: 5, known: [RAIL_A] }))).toContain("no such job");
    expect(posts).toHaveLength(0);
  });

  test("for an older line with no escrow, finds the one pinned escrow holding the job open on chain", async () => {
    const f = fresh();
    paid(f, jobId);
    const readJob: JobReader = async (r) =>
      r.escrow === ESCROW_B ? { buyer: buyer.address, status: 5 } : { buyer: "0x0000000000000000000000000000000000000000", status: 0 };
    const done = await disputeJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A, RAIL_B], readJob });
    expect(done.escrow).toBe(ESCROW_B);
  });

  test("refuses when no pinned escrow, or more than one, holds the job open for this agent", async () => {
    const none: JobReader = async () => ({ buyer: buyer.address, status: 2 });
    const both: JobReader = async () => ({ buyer: buyer.address, status: 1 });
    const someoneElse: JobReader = async () => ({ buyer: stranger.address, status: 1 });
    for (const readJob of [none, both, someoneElse]) {
      const f = fresh();
      paid(f, jobId);
      expect(await refusal(() => disputeJob({ hub, ...f, signer: buyer, jobId, now: 5, known: [RAIL_A, RAIL_B], readJob }))).toContain(
        "No single pinned escrow",
      );
    }
    expect(posts).toHaveLength(0);
  });
});

describe("resume after a dispute", () => {
  const jobId = jobIdOf(terms, 5042002, ESCROW_A);

  test("gives the budget back only once the chain reports the job Disputed", async () => {
    const f = fresh();
    paid(f, jobId, { escrow: ESCROW_A });
    f.journal.append({ at: 2, kind: "disputed", jobId, offerHash: OFFER, seller: seller.address, amount: "1000", network: "eip155:5042002" });
    expect(f.journal.spend().total).toBe("1000");
    hubJob = { status: "disputed" };

    const stillOpen = await resume({ hub, ...f, known: [RAIL_A], readJobStatus: async () => 1 });
    expect(stillOpen[0]?.status).toBe("hub says refunded; chain does not");
    expect(f.journal.spend().total).toBe("1000");

    const landed = await resume({ hub, ...f, known: [RAIL_A], readJobStatus: async () => 6 });
    expect(landed[0]?.appended).toBe("refunded");
    expect(f.journal.spend().total).toBe("0");
  });
});
