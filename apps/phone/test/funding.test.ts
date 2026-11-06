import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import type { JobOrder } from "@countersign/core";
import {
  ARC_USDC,
  fundingRefusal,
  STATUS,
  termsRefusal,
  UNPAID,
  type ChainJob,
  type FundingCheck,
} from "../src/runner/funding.ts";
import { offerFor } from "../src/runner/skills.ts";

const NOW = 1_800_000_000;
const SELLER = "0x00000000000000000000000000000000000000aa" as Address;
const ESCROW = "0x19c27d770969291e6a0a305dc1be1a845e7c1b76" as Address;
const offer = offerFor("phone-location", SELLER, NOW - 100);
const OFFER_HASH = `0x${"ab".repeat(32)}` as Hex;
const JOB_ID = `0x${"cd".repeat(32)}` as Hex;

const order = (over: Partial<JobOrder> = {}): JobOrder => ({
  jobId: JOB_ID,
  offerHash: OFFER_HASH,
  input: {},
  rail: "escrow",
  network: "eip155:5042002",
  buyer: "0x5555555555555555555555555555555555555555",
  payTo: SELLER,
  asset: ARC_USDC,
  amount: offer.price,
  deadline: NOW + 120,
  escrow: ESCROW,
  chainId: 5042002,
  lineage: [],
  ...over,
});

const funded = (over: Partial<ChainJob> = {}): ChainJob => ({
  buyer: "0x5555555555555555555555555555555555555555",
  deadline: BigInt(NOW + 120),
  status: STATUS.Funded,
  payee: SELLER,
  amount: BigInt(offer.price),
  offerHash: OFFER_HASH,
  slipHash: `0x${"00".repeat(32)}`,
  ...over,
});

function check(job: ChainJob | Error, reads: Hex[] = []): FundingCheck {
  return {
    seller: SELLER,
    now: NOW,
    known: [{ chainId: 5042002, escrow: ESCROW }],
    retryMs: 0,
    read: async (_chainId, _escrow, jobId) => {
      reads.push(jobId);
      if (job instanceof Error) throw job;
      return job;
    },
  };
}

describe("the order's own terms", () => {
  test("match the offer: price, payee, rail, Arc USDC", () => {
    expect(termsRefusal(order(), offer)).toBeNull();
    expect(termsRefusal(order({ payTo: SELLER.toUpperCase().replace("0X", "0x") }), offer)).toBeNull();
  });

  test("a different amount, payee, rail, network or asset is refused", () => {
    expect(termsRefusal(order({ amount: "1" }), offer)).toBe(UNPAID.terms);
    expect(termsRefusal(order({ amount: "10001" }), offer)).toBe(UNPAID.terms);
    expect(termsRefusal(order({ payTo: "0x00000000000000000000000000000000000000bb" }), offer)).toBe(UNPAID.terms);
    expect(termsRefusal(order({ rail: "gateway" }), offer)).toBe(UNPAID.terms);
    expect(termsRefusal(order({ network: "eip155:1874", chainId: 1874 }), offer)).toBe(UNPAID.terms);
    expect(termsRefusal(order({ asset: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" }), offer)).toBe(UNPAID.terms);
  });
});

describe("the job on chain", () => {
  test("funded for this seller, this offer, at the price, before the deadline: served", async () => {
    expect(await fundingRefusal(order(), offer, check(funded()))).toBeNull();
    expect(await fundingRefusal(order(), offer, check(funded({ amount: BigInt(offer.price) + 1n })))).toBeNull();
  });

  test("a hub claiming the price while the chain holds one unit is refused", async () => {
    expect(await fundingRefusal(order(), offer, check(funded({ amount: 1n })))).toBe(UNPAID.amount);
  });

  test("not funded, already released or refunded, or never funded: refused", async () => {
    expect(await fundingRefusal(order(), offer, check(funded({ status: STATUS.None })))).toBe(UNPAID.notFunded);
    expect(await fundingRefusal(order(), offer, check(funded({ status: STATUS.Released })))).toBe(UNPAID.notFunded);
    expect(await fundingRefusal(order(), offer, check(funded({ status: STATUS.Refunded })))).toBe(UNPAID.notFunded);
  });

  test("another payee, another offer or a passed deadline on chain: refused", async () => {
    const other = "0x00000000000000000000000000000000000000bb" as Address;
    expect(await fundingRefusal(order(), offer, check(funded({ payee: other })))).toBe(UNPAID.payee);
    expect(await fundingRefusal(order(), offer, check(funded({ offerHash: `0x${"ee".repeat(32)}` })))).toBe(UNPAID.offer);
    expect(await fundingRefusal(order(), offer, check(funded({ deadline: BigInt(NOW) })))).toBe(UNPAID.deadline);
  });

  test("an escrow the phone does not know is refused without reading anything", async () => {
    const reads: Hex[] = [];
    const theirs = "0x4444444444444444444444444444444444444444" as Address;
    expect(await fundingRefusal(order({ escrow: theirs }), offer, check(funded(), reads))).toBe(UNPAID.escrow);
    expect(await fundingRefusal(order({ chainId: 1874 }), offer, check(funded(), reads))).toBe(UNPAID.terms);
    expect(await fundingRefusal(order({ escrow: undefined }), offer, check(funded(), reads))).toBe(UNPAID.escrow);
    expect(reads).toEqual([]);
  });

  test("a fund the public node has not seen yet is read again, then served", async () => {
    const seen: ChainJob[] = [funded({ status: STATUS.None }), funded({ status: STATUS.None }), funded()];
    let reads = 0;
    const lagging: FundingCheck = {
      ...check(funded()),
      read: async () => seen[Math.min(reads++, seen.length - 1)] as ChainJob,
    };
    expect(await fundingRefusal(order(), offer, lagging)).toBeNull();
    expect(reads).toBe(3);
  });

  test("a job never seen is refused after the retries, and a final status is not retried", async () => {
    const reads: Hex[] = [];
    expect(await fundingRefusal(order(), offer, { ...check(funded({ status: STATUS.None }), reads), retries: 2 })).toBe(
      UNPAID.notFunded,
    );
    expect(reads).toHaveLength(3);
    const once: Hex[] = [];
    expect(await fundingRefusal(order(), offer, check(funded({ status: STATUS.Released }), once))).toBe(UNPAID.notFunded);
    expect(once).toHaveLength(1);
  });

  test("a chain that cannot be read is a refusal, never a pass", async () => {
    expect(await fundingRefusal(order(), offer, check(new Error("rpc down")))).toBe(UNPAID.unread);
  });
});
