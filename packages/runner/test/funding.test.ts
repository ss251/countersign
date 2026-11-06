import { describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  offerHash as hashOffer,
  RUNNER_PATH,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import type { Address, Hex } from "viem";
import { fundingFor, parseOptions } from "../src/cli.ts";
import { startRunner } from "../src/daemon.ts";
import {
  ARC_RPC_URL,
  ARC_TESTNET,
  fundingRefusal,
  STATUS,
  UNPAID,
  WHITECHAIN_TESTNET,
  type ChainJob,
  type FundingCheck,
  type JobReader,
  type PinnedEscrow,
} from "../src/funding.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const NOW = 1_700_000_000;

const SELLER = "0x1111111111111111111111111111111111111111" as Address;
const BUYER = "0x2222222222222222222222222222222222222222" as Address;
const ESCROW = "0x19c27d770969291e6a0a305dc1be1a845e7c1b76" as Address;
const OTHER_ESCROW = "0x4444444444444444444444444444444444444444" as Address;
const ASSET = "0x3600000000000000000000000000000000000000" as Address;
const OFFER_HASH: Hex = `0x${"aa".repeat(32)}`;
const OTHER_HASH: Hex = `0x${"dd".repeat(32)}`;
const JOB_ID: Hex = `0x${"bb".repeat(32)}`;
const SLIP_HASH: Hex = `0x${"cc".repeat(32)}`;

const offer: Offer = {
  v: 1,
  seller: SELLER,
  title: "Test skill",
  summary: "A skill the funding tests serve.",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1000",
  deadline: 120,
  bond: "0",
  rails: ["escrow", "gateway", "whitechain"],
  issuedAt: NOW,
};

function order(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    jobId: JOB_ID,
    offerHash: OFFER_HASH,
    input: { question: "What does this skill say?" },
    rail: "escrow",
    network: "eip155:5042002",
    buyer: BUYER,
    payTo: SELLER,
    asset: ASSET,
    amount: "1000",
    deadline: NOW + 60,
    escrow: ESCROW,
    chainId: ARC_TESTNET,
    lineage: [],
    ...overrides,
  };
}

function chainJob(overrides: Partial<ChainJob> = {}): ChainJob {
  return {
    buyer: BUYER,
    deadline: BigInt(NOW + 60),
    status: STATUS.Funded,
    payee: SELLER,
    amount: 1000n,
    offerHash: OFFER_HASH,
    slipHash: SLIP_HASH,
    ...overrides,
  };
}

function check(read: JobReader, overrides: Partial<FundingCheck> = {}): FundingCheck {
  return {
    now: () => NOW,
    known: [{ chainId: ARC_TESTNET, escrow: ESCROW }],
    read,
    retries: 4,
    retryMs: 0,
    ...overrides,
  };
}

describe("fundingRefusal", () => {
  test("a pinned escrow with a funded job for this offer passes", async () => {
    let calls = 0;
    const read: JobReader = async () => {
      calls += 1;
      return chainJob();
    };
    expect(await fundingRefusal(order(), offer, check(read))).toBeNull();
    expect(calls).toBe(1);
  });

  test("the chain payee is the offer's payee for the rail", async () => {
    const payTo = "0x5555555555555555555555555555555555555555" as Address;
    const paidOffer: Offer = { ...offer, payTo: { escrow: payTo } };
    const readPaid: JobReader = async () => chainJob({ payee: payTo });
    expect(await fundingRefusal(order({ payTo }), paidOffer, check(readPaid))).toBeNull();
    expect(await fundingRefusal(order({ payTo }), paidOffer, check(async () => chainJob()))).toBe(
      UNPAID.payee,
    );
  });

  test("refuses an escrow the runner does not know, without reading the chain", async () => {
    const read: JobReader = async () => {
      throw new Error("the chain was read");
    };
    expect(await fundingRefusal(order(), offer, check(read, { known: [] }))).toBe(UNPAID.escrow);
  });

  test("refuses a job still unseen after the retries", async () => {
    let calls = 0;
    const read: JobReader = async () => {
      calls += 1;
      return chainJob({ status: STATUS.None });
    };
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.notFunded);
    expect(calls).toBe(5);
  });

  test("refuses a job that pays someone else", async () => {
    const read: JobReader = async () => chainJob({ payee: OTHER_ESCROW });
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.payee);
  });

  test("refuses a job that holds less than the price", async () => {
    const read: JobReader = async () => chainJob({ amount: 999n });
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.amount);
  });

  test("refuses a job for another offer", async () => {
    const read: JobReader = async () => chainJob({ offerHash: OTHER_HASH });
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.offer);
  });

  test("refuses a job whose deadline has passed", async () => {
    const read: JobReader = async () => chainJob({ deadline: BigInt(NOW) });
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.deadline);
  });

  test("refuses when the job cannot be read", async () => {
    let calls = 0;
    const read: JobReader = async () => {
      calls += 1;
      throw new Error("the RPC is down");
    };
    expect(await fundingRefusal(order(), offer, check(read))).toBe(UNPAID.unread);
    expect(calls).toBe(5);
  });

  test("passes when the job appears Funded on the third read", async () => {
    const statuses = [STATUS.None, STATUS.None, STATUS.Funded];
    let calls = 0;
    const read: JobReader = async () => {
      const status = statuses[calls] ?? STATUS.None;
      calls += 1;
      return chainJob({ status });
    };
    expect(await fundingRefusal(order(), offer, check(read))).toBeNull();
    expect(calls).toBe(3);
  });

  test("a gateway order passes the terms check without reading the chain", async () => {
    const read: JobReader = async () => {
      throw new Error("the chain was read");
    };
    const gateway = order({ rail: "gateway", escrow: undefined, chainId: undefined });
    expect(await fundingRefusal(gateway, offer, check(read))).toBeNull();
  });

  test("a whitechain order is an escrow order and reads the chain", async () => {
    const known: PinnedEscrow[] = [{ chainId: WHITECHAIN_TESTNET, escrow: ESCROW }];
    let calls = 0;
    const read: JobReader = async (chainId, escrow) => {
      calls += 1;
      expect(chainId).toBe(WHITECHAIN_TESTNET);
      expect(escrow).toBe(ESCROW);
      return chainJob();
    };
    const whitechain = order({
      rail: "whitechain",
      network: "eip155:1874",
      chainId: WHITECHAIN_TESTNET,
    });
    expect(await fundingRefusal(whitechain, offer, check(read, { known }))).toBeNull();
    expect(calls).toBe(1);
  });

  test("refuses an order whose rail is not in the offer", async () => {
    const read: JobReader = async () => {
      throw new Error("the chain was read");
    };
    const eip3009 = order({ rail: "eip3009" });
    expect(await fundingRefusal(eip3009, offer, check(read))).toBe(UNPAID.terms);
  });

  test("refuses an order whose amount is not the offer's price", async () => {
    const read: JobReader = async () => {
      throw new Error("the chain was read");
    };
    expect(await fundingRefusal(order({ amount: "999" }), offer, check(read))).toBe(UNPAID.terms);
  });

  test("refuses an order whose payee is not the offer's payee", async () => {
    const read: JobReader = async () => {
      throw new Error("the chain was read");
    };
    expect(await fundingRefusal(order({ payTo: BUYER }), offer, check(read))).toBe(UNPAID.terms);
  });
});

describe("fundingFor", () => {
  const base = ["--hub", "http://127.0.0.1:1", "--skill", "SKILL.md", "--price", "1000"];

  test("no flags uses KNOWN_ESCROWS and a default RPC for both pinned chains", () => {
    const funding = fundingFor(parseOptions(base), {});
    expect(funding.known).toContainEqual({ chainId: ARC_TESTNET, escrow: ESCROW });
    expect(funding.known.length).toBeGreaterThan(0);
    expect(funding.rpc?.[ARC_TESTNET]).toBe(ARC_RPC_URL);
    // A pinned Whitechain escrow must never be refused for want of an RPC.
    expect(funding.rpc?.[WHITECHAIN_TESTNET]).toBe("https://rpc.ankr.com/whitechain_testnet");
  });

  test("--known-escrow and --rpc add to the defaults", () => {
    const options = parseOptions([
      ...base,
      "--known-escrow",
      `${ARC_TESTNET}=${OTHER_ESCROW}`,
      "--rpc",
      `${WHITECHAIN_TESTNET}=https://rpc.example.test/1874`,
    ]);
    const funding = fundingFor(options, {});
    expect(funding.known).toContainEqual({ chainId: ARC_TESTNET, escrow: ESCROW });
    expect(funding.known).toContainEqual({ chainId: ARC_TESTNET, escrow: OTHER_ESCROW });
    expect(funding.rpc?.[ARC_TESTNET]).toBe(ARC_RPC_URL);
    expect(funding.rpc?.[WHITECHAIN_TESTNET]).toBe("https://rpc.example.test/1874");
  });

  test("the environment fills the RPCs and flags override it", () => {
    const funding = fundingFor(parseOptions(base), {
      ARC_RPC_URL: "https://arc.example.test",
      WC_RPC_URL: "https://wc.example.test",
    });
    expect(funding.rpc?.[ARC_TESTNET]).toBe("https://arc.example.test");
    expect(funding.rpc?.[WHITECHAIN_TESTNET]).toBe("https://wc.example.test");

    const overridden = fundingFor(parseOptions([...base, "--rpc", `${ARC_TESTNET}=https://mine.test`]), {
      ARC_RPC_URL: "https://arc.example.test",
    });
    expect(overridden.rpc?.[ARC_TESTNET]).toBe("https://mine.test");
  });
});

describe("startRunner with funding", () => {
  test("sends fail and never spawns the child when the job is not funded", async () => {
    const viem: Viem = await loadViem();
    const account = viem.privateKeyToAccount(PRIVATE_KEY);
    const skill = await readSkill(FIXTURE);
    const servedOffer = skillOffer({
      seller: account.address,
      skill,
      price: "1000",
      deadline: 120,
      rails: ["escrow"],
      now: NOW,
    });
    const servedHash = hashOffer(servedOffer);

    let pending: ((message: RunnerToHub) => void) | null = null;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let resolveConnected: (ws: ServerWebSocket<undefined>) => void = () => undefined;
    const connected = new Promise<ServerWebSocket<undefined>>((resolve) => {
      resolveConnected = resolve;
    });

    const server: Server<undefined> = Bun.serve({
      port: 0,
      fetch(request, srv) {
        if (new URL(request.url).pathname === RUNNER_PATH) {
          if (srv.upgrade(request)) return;
          return new Response("upgrade failed", { status: 500 });
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          resolveConnected(ws);
          ws.send(JSON.stringify({ t: "challenge", nonce: "funding-test" }));
        },
        message(ws, raw) {
          const message = JSON.parse(
            typeof raw === "string" ? raw : raw.toString("utf8"),
          ) as RunnerToHub;
          if (message.t === "hello") {
            ws.send(JSON.stringify({ t: "ready", seller: account.address, offers: [servedHash] }));
            resolveReady();
            return;
          }
          if (message.t === "result" || message.t === "fail") {
            const resolve = pending;
            pending = null;
            resolve?.(message);
          }
        },
      },
    });

    const handle = startRunner({
      hubUrl: `http://127.0.0.1:${server.port}`,
      account,
      // If the child ran, reading this path would fail and the reply would be that error.
      served: [{ offer: servedOffer, spec: { adapter: "skill", skillPath: "/nonexistent/SKILL.md" } }],
      now: () => NOW,
      funding: {
        known: [{ chainId: ARC_TESTNET, escrow: ESCROW }],
        read: async () => chainJob({ status: STATUS.None }),
        retries: 1,
        retryMs: 0,
      },
    });

    try {
      await ready;
      await handle.ready;
      const target = await connected;

      const sent: JobOrder = {
        jobId: JOB_ID,
        offerHash: servedHash,
        input: { question: "What does this skill say?" },
        rail: "escrow",
        network: "eip155:5042002",
        buyer: BUYER,
        payTo: account.address,
        asset: ASSET,
        amount: "1000",
        deadline: NOW + 60,
        escrow: ESCROW,
        chainId: ARC_TESTNET,
        lineage: [],
      };
      const reply = await new Promise<RunnerToHub>((resolve) => {
        pending = resolve;
        target.send(JSON.stringify({ t: "job", order: sent }));
      });
      if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
      expect(reply.reason).toBe(UNPAID.notFunded);
    } finally {
      handle.stop();
      await server.stop(true);
    }
  });
});
