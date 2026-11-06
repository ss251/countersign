import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  canonicalHash,
  checkSchema,
  offerHash as hashOffer,
  RUNNER_PATH,
  runnerAuthMessage,
  slipHash,
  slipTypedData,
  type JobOrder,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer, SKILL_OUTPUT_SCHEMA } from "../src/skill.ts";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const BUYER = "0x2222222222222222222222222222222222222222";
const ESCROW = "0x4444444444444444444444444444444444444444";
const ASSET = "0x3600000000000000000000000000000000000000";

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let offer: Offer;
let offerHash: Hex;
let clock: number;
let server: Server<undefined>;
let handle: RunnerHandle;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;
let hello: Extract<RunnerToHub, { t: "hello" }> | null;
let recovered: Address | null;

beforeEach(async () => {
  seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const skill = await readSkill(FIXTURE);
  offer = skillOffer({
    seller: seller.address,
    skill,
    price: "1000",
    deadline: 120,
    rails: ["escrow"],
    now: NOW,
  });
  offerHash = hashOffer(offer);
  clock = NOW;
  socket = null;
  pending = null;
  hello = null;
  recovered = null;

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
              ws.send(
                JSON.stringify({ t: "ready", seller: seller.address, offers: [offerHash] }),
              );
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
  });

  await helloChecked;
  await handle.ready;
});

afterEach(async () => {
  handle.stop();
  await server.stop(true);
});

describe("startRunner", () => {
  test("serves a job with a slip signed by the seller", async () => {
    expect(recovered?.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(hello?.seller.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(hello?.offers).toEqual([offerHash]);

    const order = makeOrder();
    const reply = await sendJob(order);
    if (reply.t !== "result") throw new Error(`expected result, got ${reply.t}`);

    expect(reply.jobId).toBe(order.jobId);
    expect(reply.slip.hash).toBe(slipHash(reply.slip.body));
    const signer = await viem.recoverTypedDataAddress({
      ...slipTypedData(reply.slip.body),
      signature: reply.slip.sellerSig,
    });
    expect(signer.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(reply.slip.body.outputHash).toBe(canonicalHash(reply.output));
    expect(reply.slip.body.inputHash).toBe(canonicalHash(order.input));
    expect(reply.slip.body.offerHash).toBe(order.offerHash);
    expect(reply.slip.body.seller.toLowerCase()).toBe(seller.address.toLowerCase());
    expect(checkSchema(SKILL_OUTPUT_SCHEMA, reply.output).ok).toBe(true);
  });

  test("refuses input that fails the offer schema", async () => {
    const reply = await sendJob(makeOrder({ input: { question: 42 } }));
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. The input does not match the offer's schema.");
  });

  test("refuses a job past its deadline", async () => {
    const reply = await sendJob(makeOrder({ deadline: clock - 1 }));
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. The deadline has passed.");
  });

  test("refuses an offer it does not serve", async () => {
    const reply = await sendJob(makeOrder({ offerHash: `0x${"cd".repeat(32)}` }));
    if (reply.t !== "fail") throw new Error(`expected fail, got ${reply.t}`);
    expect(reply.reason).toBe("Refused. This runner does not serve that offer.");
  });
});

function makeOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    jobId: `0x${"ab".repeat(32)}`,
    offerHash,
    input: { question: "What does this skill say?" },
    rail: "escrow",
    network: "eip155:5042002",
    buyer: BUYER,
    payTo: seller.address,
    asset: ASSET,
    amount: "1000",
    deadline: clock + 60,
    escrow: ESCROW,
    chainId: 5042002,
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
