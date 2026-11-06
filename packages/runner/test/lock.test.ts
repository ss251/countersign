import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  lockTypedData,
  offerHash as hashOffer,
  RUNNER_PATH,
  type HubToRunner,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { verifyTypedData } from "viem";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const ESCROW = "0x4444444444444444444444444444444444444444" as Address;
const CHAIN_ID = 5042002;
const JOB_ID = `0x${"ab".repeat(32)}` as Hex;

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let bonded: Offer;
let bondedHash: Hex;
let unbonded: Offer;
let unbondedHash: Hex;
let server: Server<undefined>;
let handle: RunnerHandle;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;

beforeEach(async () => {
  seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const skill = await readSkill(FIXTURE);
  const base = skillOffer({
    seller: seller.address,
    skill,
    price: "1000",
    deadline: 120,
    rails: ["escrow"],
    now: NOW,
  });
  bonded = { ...base, bond: "100" };
  unbonded = { ...base, bond: "0" };
  bondedHash = hashOffer(bonded);
  unbondedHash = hashOffer(unbonded);
  socket = null;
  pending = null;

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
          ws.send(
            JSON.stringify({
              t: "ready",
              seller: seller.address,
              offers: [bondedHash, unbondedHash],
            }),
          );
          return;
        }
        if (message.t === "locked" || message.t === "lock-refused") {
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
    served: [
      { offer: bonded, spec: { adapter: "skill", skillPath: FIXTURE } },
      { offer: unbonded, spec: { adapter: "skill", skillPath: FIXTURE } },
    ],
    limits: { timeMs: 5000, maxOutputBytes: 100_000 },
    now: () => NOW,
  });

  await handle.ready;
});

afterEach(async () => {
  handle.stop();
  await server.stop(true);
});

describe("the runner's lock handler", () => {
  test("signs Lock(jobId) for a served bonded offer", async () => {
    const reply = await sendLock();
    if (reply.t !== "locked") throw new Error(`expected locked, got ${reply.t}`);

    expect(reply.jobId).toBe(JOB_ID);
    const verified = await verifyTypedData({
      address: seller.address,
      ...lockTypedData(CHAIN_ID, ESCROW, JOB_ID),
      signature: reply.sig,
    });
    expect(verified).toBe(true);
  });

  test("refuses a bond that is not the served offer's", async () => {
    const reply = await sendLock({ bond: "99" });
    if (reply.t !== "lock-refused") throw new Error(`expected lock-refused, got ${reply.t}`);
    expect(reply.jobId).toBe(JOB_ID);
    expect(reply.reason).toBe("Refused. The bond does not match this offer.");
  });

  test("refuses a lock on a served offer with no bond", async () => {
    const reply = await sendLock({ offerHash: unbondedHash, bond: "0" });
    if (reply.t !== "lock-refused") throw new Error(`expected lock-refused, got ${reply.t}`);
    expect(reply.jobId).toBe(JOB_ID);
    expect(reply.reason).toBe("Refused. The bond does not match this offer.");
  });

  test("refuses an offer it does not serve", async () => {
    const reply = await sendLock({ offerHash: `0x${"cd".repeat(32)}` });
    if (reply.t !== "lock-refused") throw new Error(`expected lock-refused, got ${reply.t}`);
    expect(reply.jobId).toBe(JOB_ID);
    expect(reply.reason).toBe("Refused. This runner does not serve that offer.");
  });
});

function sendLock(
  overrides: Partial<Extract<HubToRunner, { t: "lock" }>> = {},
): Promise<RunnerToHub> {
  if (!socket) throw new Error("the hub is not connected");
  const frame: Extract<HubToRunner, { t: "lock" }> = {
    t: "lock",
    jobId: JOB_ID,
    offerHash: bondedHash,
    escrow: ESCROW,
    chainId: CHAIN_ID,
    bond: "100",
    ...overrides,
  };
  const reply = new Promise<RunnerToHub>((resolve) => {
    pending = resolve;
  });
  socket.send(JSON.stringify(frame));
  return reply;
}
