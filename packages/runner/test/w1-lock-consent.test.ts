import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import { offerHash as hashOffer, RUNNER_PATH, type Offer, type RunnerToHub } from "@countersign/core";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

// cs-w1 adversarial test (B28; runs on cs/33-runner-hub-lock, PR #244). A failing test here is a blocker.
// The payee's Lock(jobId, funder) is its consent to one job, the fix for Grok's High 1 ("the arbiter locks a
// bond the payee never accepted"). The runner signs whatever jobId, escrow and chain the hub's lock frame
// names, after checking only the funder's shape and the bond's amount. So whoever speaks as the hub can get
// the seller's lock for a job it invented on the seller's registered terms, with itself as buyer and funder,
// fund it, never dispatch it, and take amount + bond at the default refund. The runner must refuse a lock
// unless it rebuilds that exact jobId from terms it checked itself (its own payee address, its offer's price,
// bond and review window, a deadline it can meet), on an escrow it knows.

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const ESCROW = "0x4444444444444444444444444444444444444444" as Address;
const CHAIN_ID = 5042002;
const FUNDER = "0x5555555555555555555555555555555555555555" as Address;
const INVENTED_JOB = `0x${"ab".repeat(32)}` as Hex;

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let bonded: Offer;
let bondedHash: Hex;
let server: Server<undefined>;
let handle: RunnerHandle;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;

beforeEach(async () => {
  seller = viem.privateKeyToAccount(PRIVATE_KEY);
  const skill = await readSkill(FIXTURE);
  const base = skillOffer({ seller: seller.address, skill, price: "1000", deadline: 120, rails: ["escrow"], now: NOW });
  bonded = { ...base, bond: "100", reviewWindow: 3600 } as Offer;
  bondedHash = hashOffer(bonded);
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
          ws.send(JSON.stringify({ t: "ready", seller: seller.address, offers: [bondedHash] }));
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
    served: [{ offer: bonded, spec: { adapter: "skill", skillPath: FIXTURE } }],
    limits: { timeMs: 5000, maxOutputBytes: 100_000 },
    now: () => NOW,
  });
  await handle.ready;
});

afterEach(async () => {
  handle.stop();
  await server.stop(true);
});

function sendFrame(frame: Record<string, unknown>): Promise<RunnerToHub> {
  if (!socket) throw new Error("the hub is not connected");
  const reply = new Promise<RunnerToHub>((resolve) => {
    pending = resolve;
  });
  socket.send(JSON.stringify(frame));
  return reply;
}

describe("W1 B28: the seller's lock is consent to a job it can derive, not to whatever the hub names", () => {
  test("a lock for a job id the runner cannot rebuild from the offer's terms is refused", async () => {
    const reply = await sendFrame({
      t: "lock",
      jobId: INVENTED_JOB,
      offerHash: bondedHash,
      escrow: ESCROW,
      chainId: CHAIN_ID,
      bond: "100",
      funder: FUNDER,
    });
    expect(reply.t).toBe("lock-refused");
  });

  test("a lock whose stated terms do not derive the job id is refused", async () => {
    // Plausible terms in the frame, under the names a fix would likely use, that do not hash to INVENTED_JOB.
    const reply = await sendFrame({
      t: "lock",
      jobId: INVENTED_JOB,
      offerHash: bondedHash,
      escrow: ESCROW,
      chainId: CHAIN_ID,
      bond: "100",
      funder: FUNDER,
      buyer: FUNDER,
      payee: seller.address,
      amount: "1000",
      deadline: NOW + 120,
      salt: "1",
      reviewWindow: 3600,
      terms: { buyer: FUNDER, payee: seller.address, amount: "1000", deadline: NOW + 120, salt: "1", bond: "100", reviewWindow: 3600 },
    });
    expect(reply.t).toBe("lock-refused");
  });
});
