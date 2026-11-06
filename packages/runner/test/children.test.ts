import { describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  offerHash as hashOffer,
  RUNNER_PATH,
  runnerAuthMessage,
  slipHash,
  slipTypedData,
  type JobOrder,
  type RunnerToHub,
} from "@countersign/core";
import type { Address, Hex } from "../src/account.ts";
import { parseOptions } from "../src/cli.ts";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const BUYER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const EXTRA = "0x5555555555555555555555555555555555555555";
const ESCROW = "0x4444444444444444444444444444444444444444";
const ASSET = "0x3600000000000000000000000000000000000000";
const JOB_ID = `0x${"ab".repeat(32)}` as Hex;
const ANCESTOR = `0x${"12".repeat(32)}` as Hex;
const OWN_HASH = `0x${"AB".repeat(32)}` as Hex;
const OWN_HASH_LOWER = `0x${"ab".repeat(32)}` as Hex;
const STRANGER_HASH = `0x${"cd".repeat(32)}` as Hex;
const EXTRA_HASH = `0x${"ff".repeat(32)}` as Hex;

const viem: Viem = await loadViem();

interface ChildRow {
  jobId: string;
  offerHash: string;
  status: string;
  slipHash: string | null;
}

interface Session {
  sellerAddress: Address;
  sendJob(order: JobOrder): Promise<RunnerToHub>;
  order(overrides?: Partial<JobOrder>): JobOrder;
  stop(): Promise<void>;
}

describe("slip children", () => {
  test("attests a purchase made by the runner and not one made by a stranger", async () => {
    const session = await start({
      protocol: "ws",
      children: [
        { jobId: `0x${"01".repeat(32)}`, offerHash: `0x${"02".repeat(32)}`, status: "released", slipHash: OWN_HASH },
        { jobId: `0x${"03".repeat(32)}`, offerHash: `0x${"04".repeat(32)}`, status: "released", slipHash: STRANGER_HASH },
      ],
      slips: {
        [OWN_HASH]: RUNNER,
        [STRANGER_HASH]: STRANGER,
      },
    });
    try {
      const reply = await session.sendJob(session.order());
      await expectSigned(reply, session.sellerAddress, [OWN_HASH_LOWER]);
    } finally {
      await session.stop();
    }
  });

  test("delivers with an empty children list when the hub times out", async () => {
    const session = await start({ hang: true });
    try {
      const reply = await session.sendJob(session.order());
      await expectSigned(reply, session.sellerAddress, []);
    } finally {
      await session.stop();
    }
  }, 15_000);

  test("the child env carries COUNTERSIGN_LINEAGE and no other new variable", async () => {
    const session = await start({});
    const seen: Array<Record<string, string | undefined>> = [];
    const previous = process.env.CS_SELLER_KEY;
    process.env.CS_SELLER_KEY = "0xsupersecret";
    const restore = captureSpawn(seen);
    try {
      const reply = await session.sendJob(session.order({ lineage: [ANCESTOR] }));
      if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);
      expect(seen).toHaveLength(1);
      const env = seen[0];
      expect(Object.keys(env ?? {}).sort()).toEqual(["COUNTERSIGN_LINEAGE", "HOME", "PATH"]);
      expect(env?.COUNTERSIGN_LINEAGE).toBe(`${ANCESTOR},${JOB_ID}`);
      expect(JSON.stringify(env)).not.toContain("0xsupersecret");
    } finally {
      restore();
      if (previous === undefined) delete process.env.CS_SELLER_KEY;
      else process.env.CS_SELLER_KEY = previous;
      await session.stop();
    }
  });

  test("also attests purchases made by a configured child buyer, sorted and de-duplicated", async () => {
    const ownAgain = `0x${"AB".repeat(32)}` as Hex;
    const session = await start({
      buyerAddresses: [EXTRA],
      children: [
        { jobId: `0x${"05".repeat(32)}`, offerHash: `0x${"06".repeat(32)}`, status: "released", slipHash: EXTRA_HASH },
        { jobId: `0x${"07".repeat(32)}`, offerHash: `0x${"08".repeat(32)}`, status: "released", slipHash: OWN_HASH_LOWER },
        { jobId: `0x${"09".repeat(32)}`, offerHash: `0x${"0a".repeat(32)}`, status: "released", slipHash: ownAgain },
        { jobId: `0x${"0b".repeat(32)}`, offerHash: `0x${"0c".repeat(32)}`, status: "released", slipHash: STRANGER_HASH },
      ],
      slips: {
        [EXTRA_HASH]: EXTRA.toLowerCase(),
        [OWN_HASH_LOWER]: RUNNER,
        [ownAgain]: RUNNER,
        [STRANGER_HASH]: STRANGER,
      },
    });
    try {
      const reply = await session.sendJob(session.order());
      await expectSigned(reply, session.sellerAddress, [OWN_HASH_LOWER, EXTRA_HASH]);
    } finally {
      await session.stop();
    }
  });
});

describe("--child-buyer", () => {
  test("repeats and keeps each address", () => {
    const options = parseOptions([
      "--hub",
      "http://127.0.0.1:1",
      "--skill",
      FIXTURE,
      "--price",
      "1000",
      "--child-buyer",
      EXTRA,
      "--child-buyer",
      "0.0.1234",
    ]);
    expect(options.buyerAddresses).toEqual([EXTRA, "0.0.1234"]);
  });
});

const RUNNER = "$runner";

async function start(opts: {
  protocol?: "http" | "ws";
  hang?: boolean;
  children?: ChildRow[];
  slips?: Record<string, string>;
  buyerAddresses?: string[];
}): Promise<Session> {
  const seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const slips = { ...(opts.slips ?? {}) };
  for (const [hash, buyer] of Object.entries(slips)) {
    if (buyer === RUNNER) slips[hash] = seller.address.toLowerCase();
  }
  const skill = await readSkill(FIXTURE);
  const offer = skillOffer({
    seller: seller.address,
    skill,
    price: "1000",
    deadline: 120,
    rails: ["escrow"],
    now: NOW,
  });
  const offerHash = hashOffer(offer);
  let releaseHang: (() => void) | undefined;
  let socket: ServerWebSocket<undefined> | null = null;
  let pending: ((message: RunnerToHub) => void) | null = null;

  let resolveHello: () => void = () => undefined;
  let rejectHello: (error: unknown) => void = () => undefined;
  const helloChecked = new Promise<void>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });

  const server: Server<undefined> = Bun.serve({
    port: 0,
    fetch(request, srv) {
      const url = new URL(request.url);
      if (url.pathname === RUNNER_PATH) {
        if (srv.upgrade(request)) return undefined;
        return new Response("upgrade failed", { status: 500 });
      }
      if (url.pathname === `/jobs/${JOB_ID}/children`) {
        if (opts.hang) {
          return new Promise((resolve) => {
            releaseHang = () => resolve(new Response(null, { status: 204 }));
          });
        }
        return Response.json({ jobId: JOB_ID, children: opts.children ?? [] });
      }
      if (url.pathname.startsWith("/slips/")) {
        const hash = decodeURIComponent(url.pathname.slice("/slips/".length));
        const buyer = slips[hash];
        if (buyer === undefined) return new Response("missing", { status: 404 });
        return Response.json({ body: { buyer } });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        socket = ws;
        ws.send(JSON.stringify({ t: "challenge", nonce: NONCE }));
      },
      message(ws, raw) {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const message = JSON.parse(text) as RunnerToHub;
        if (message.t === "hello") {
          viem
            .recoverMessageAddress({ message: runnerAuthMessage(NONCE), signature: message.sig })
            .then(() => {
              ws.send(JSON.stringify({ t: "ready", seller: seller.address, offers: [offerHash] }));
              resolveHello();
            })
            .catch(rejectHello);
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

  const handle: RunnerHandle = startRunner({
    hubUrl: `${opts.protocol ?? "http"}://127.0.0.1:${server.port}`,
    account: seller,
    served: [{ offer, spec: { adapter: "skill", skillPath: FIXTURE } }],
    limits: { timeMs: 5000, maxOutputBytes: 100_000 },
    now: () => NOW,
    ...(opts.buyerAddresses !== undefined ? { buyerAddresses: opts.buyerAddresses } : {}),
  });
  await helloChecked;
  await handle.ready;

  return {
    sellerAddress: seller.address,
    order(overrides: Partial<JobOrder> = {}): JobOrder {
      return {
        jobId: JOB_ID,
        offerHash,
        input: { question: "What does this skill say?" },
        rail: "escrow",
        network: "eip155:5042002",
        buyer: BUYER,
        payTo: seller.address,
        asset: ASSET,
        amount: "1000",
        deadline: NOW + 60,
        escrow: ESCROW,
        chainId: 5042002,
        lineage: [],
        ...overrides,
      };
    },
    sendJob(order: JobOrder): Promise<RunnerToHub> {
      if (!socket) throw new Error("the hub is not connected");
      const reply = new Promise<RunnerToHub>((resolve) => {
        pending = resolve;
      });
      socket.send(JSON.stringify({ t: "job", order }));
      return reply;
    },
    async stop(): Promise<void> {
      releaseHang?.();
      handle.stop();
      await server.stop(true);
    },
  };
}

function captureSpawn(seen: Array<Record<string, string | undefined>>): () => void {
  const real = Bun.spawn;
  const wrapped = ((cmds: string[], options?: { env?: Record<string, string | undefined> }) => {
    if (options?.env) seen.push(options.env);
    return real(cmds, options as Parameters<typeof real>[1]);
  }) as typeof Bun.spawn;
  Bun.spawn = wrapped;
  return () => {
    Bun.spawn = real;
  };
}

async function expectSigned(reply: RunnerToHub, seller: Address, children: Hex[]): Promise<void> {
  if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);
  expect(reply.slip.body.children).toEqual(children);
  expect(reply.slip.hash).toBe(slipHash(reply.slip.body));
  const signer = await viem.recoverTypedDataAddress({
    ...slipTypedData(reply.slip.body),
    signature: reply.slip.sellerSig,
  });
  expect(signer.toLowerCase()).toBe(seller.toLowerCase());
}
