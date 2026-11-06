import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  offerHash as hashOffer,
  RUNNER_PATH,
  runnerAuthMessage,
  slipHash,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { startRunner, type RunnerConfig, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const BUYER = "0x2222222222222222222222222222222222222222";

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let offer: Offer;
let offerHash: Hex;
let clock: number;
let server: Server<undefined> | null;
let handle: RunnerHandle | null;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;
let hello: Extract<RunnerToHub, { t: "hello" }> | null;
let recovered: Address | null;

beforeEach(async () => {
  seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const skill = await readSkill(FIXTURE);
  offer = {
    ...skillOffer({
      seller: seller.address,
      skill,
      price: "10000",
      deadline: 120,
      rails: ["hedera-scheduled", "hedera"],
      now: NOW,
    }),
    payTo: { "hedera-scheduled": "0.0.11337065" },
  };
  offerHash = hashOffer(offer);
  clock = NOW;
  server = null;
  handle = null;
  socket = null;
  pending = null;
  hello = null;
  recovered = null;
});

afterEach(async () => {
  handle?.stop();
  await server?.stop(true);
});

async function setup(countersign?: RunnerConfig["countersign"]): Promise<void> {
  let resolveHello: () => void = () => undefined;
  let rejectHello: (error: unknown) => void = () => undefined;
  const helloChecked = new Promise<void>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });

  server = Bun.serve({
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
        socket = ws;
        ws.send(JSON.stringify({ t: "challenge", nonce: NONCE }));
      },
      message(ws, raw) {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const message = JSON.parse(text) as RunnerToHub;
        if (message.t === "hello") {
          hello = message;
          viem
            .recoverMessageAddress({
              message: runnerAuthMessage(NONCE),
              signature: message.sig,
            })
            .then((address) => {
              recovered = address;
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

  handle = startRunner({
    hubUrl: `http://127.0.0.1:${server.port}`,
    account: seller,
    served: [{ offer, spec: { adapter: "skill", skillPath: FIXTURE } }],
    limits: { timeMs: 5000, maxOutputBytes: 100_000 },
    now: () => clock,
    countersign,
  });

  await helloChecked;
  await handle.ready;
}

function makeOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    jobId: `0x${"ab".repeat(32)}`,
    offerHash,
    input: { question: "What does this skill say?" },
    rail: "hedera-scheduled",
    network: "hedera:testnet",
    buyer: BUYER,
    payTo: "0.0.11337065",
    asset: "0.0.429274",
    amount: "10000",
    deadline: clock + 60,
    schedule: { id: "0.0.500", createTx: "0.0.11337064@1700000000.000000000" },
    lineage: [],
    ...overrides,
  };
}

function sendJob(order: JobOrder): Promise<RunnerToHub> {
  if (!socket) throw new Error("the hub is not connected");
  const reply = new Promise<RunnerToHub>((resolve) => {
    pending = resolve;
  });
  socket.send(JSON.stringify({ t: "job", order }));
  return reply;
}

describe("the runner countersigns only a checked delivery", () => {
  test("a held order calls the countersigner once and carries its bytes on the result", async () => {
    const seen: JobOrder[] = [];
    await setup(async (order) => {
      seen.push(order);
      return "c2lnbmF0dXJl";
    });

    const order = makeOrder();
    const reply = await sendJob(order);
    if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);

    expect(recovered?.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(hello?.offers).toEqual([offerHash]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.jobId).toBe(order.jobId);
    expect(seen[0]!.rail).toBe("hedera-scheduled");
    expect(seen[0]!.schedule).toEqual(order.schedule);
    expect(reply.countersign).toBe("c2lnbmF0dXJl");
    expect(reply.slip.hash).toBe(slipHash(reply.slip.body));
  });

  test("a countersigner that throws sends fail, not a result", async () => {
    await setup(async () => {
      throw new Error("seller refuses");
    });

    const reply = await sendJob(makeOrder());
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("seller refuses");
  });

  test("a held order with no countersigner sends fail", async () => {
    await setup();

    const reply = await sendJob(makeOrder());
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toContain("cannot countersign a held Hedera payment");
  });

  test("another rail calls no countersigner and carries no countersign", async () => {
    let calls = 0;
    await setup(async () => {
      calls += 1;
      return "c2lnbmF0dXJl";
    });

    const reply = await sendJob(makeOrder({ rail: "hedera", schedule: undefined }));
    if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);
    expect(calls).toBe(0);
    expect("countersign" in reply).toBe(false);
  });
});
