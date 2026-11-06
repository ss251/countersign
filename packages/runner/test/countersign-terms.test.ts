import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  offerHash as hashOffer,
  RUNNER_PATH,
  runnerAuthMessage,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { startRunner, type RunnerConfig, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const MISSING = join(import.meta.dir, "fixtures", "missing-SKILL.md");
const BUYER = "0x2222222222222222222222222222222222222222";
const HELD_PAY_TO = "0.0.11338176";

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let offer: Offer;
let offerHash: Hex;
let clock: number;
let server: Server<undefined> | null;
let handle: RunnerHandle | null;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;

beforeEach(async () => {
  seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const skill = await readSkill(FIXTURE);
  offer = skillOffer({
    seller: seller.address,
    skill,
    price: "30000",
    deadline: 120,
    rails: ["hedera-scheduled", "hedera"],
    payTo: { "hedera-scheduled": HELD_PAY_TO },
    now: NOW,
  });
  offerHash = hashOffer(offer);
  clock = NOW;
  server = null;
  handle = null;
  socket = null;
  pending = null;
});

afterEach(async () => {
  handle?.stop();
  await server?.stop(true);
});

async function setup(
  countersign?: RunnerConfig["countersign"],
  skillPath = FIXTURE,
): Promise<void> {
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
          viem
            .recoverMessageAddress({
              message: runnerAuthMessage(NONCE),
              signature: message.sig,
            })
            .then((address) => {
              if (address.toLowerCase() !== seller.address.toLowerCase()) {
                rejectHello(new Error("the runner did not prove the seller key"));
                return;
              }
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
    served: [{ offer, spec: { adapter: "skill", skillPath } }],
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
    payTo: HELD_PAY_TO,
    asset: "0.0.429274",
    amount: "30000",
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

describe("the runner refuses a held order whose terms differ from its offer", () => {
  test("an order paying less than the offer is refused before any work", async () => {
    const seen: JobOrder[] = [];
    await setup(async (order) => {
      seen.push(order);
      return "c2lnbmF0dXJl";
    }, MISSING);

    const reply = await sendJob(makeOrder({ amount: "1" }));
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. The held order's terms differ from the served offer.");
    expect(seen).toHaveLength(0);
  });

  test("an order paying someone else is refused before any work", async () => {
    const seen: JobOrder[] = [];
    await setup(async (order) => {
      seen.push(order);
      return "c2lnbmF0dXJl";
    }, MISSING);

    const reply = await sendJob(makeOrder({ payTo: "0.0.999" }));
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. The held order's terms differ from the served offer.");
    expect(seen).toHaveLength(0);
  });

  test("an offer that declares no held payee is refused before any work", async () => {
    const seen: JobOrder[] = [];
    delete offer.payTo;
    offerHash = hashOffer(offer);
    await setup(async (order) => {
      seen.push(order);
      return "c2lnbmF0dXJl";
    }, MISSING);

    const reply = await sendJob(makeOrder());
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. The held order's terms differ from the served offer.");
    expect(seen).toHaveLength(0);
  });

  test("an order that matches the offer is countersigned as before", async () => {
    const seen: JobOrder[] = [];
    await setup(async (order) => {
      seen.push(order);
      return "c2lnbmF0dXJl";
    });

    const reply = await sendJob(makeOrder());
    if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);
    expect(seen).toHaveLength(1);
    expect(reply.countersign).toBe("c2lnbmF0dXJl");
  });

  test("a held order with no countersigner is refused before any work", async () => {
    await setup(undefined, MISSING);

    const reply = await sendJob(makeOrder());
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toContain("cannot countersign a held Hedera payment");
  });
});
