import { afterEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  jobIdOf,
  lockTypedData,
  offerHash as hashOffer,
  RUNNER_PATH,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { recoverTypedDataAddress } from "viem";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Address, Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const ESCROW = "0x4444444444444444444444444444444444444444" as Address;
const OTHER_ESCROW = "0x9999999999999999999999999999999999999999" as Address;
const CHAIN_ID = 5042002;
const FUNDER = "0x5555555555555555555555555555555555555555" as Address;
const OTHER_PAYEE = "0x1111111111111111111111111111111111111111" as Address;
const INVENTED_JOB = `0x${"ab".repeat(32)}` as Hex;

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let bonded: Offer;
let bondedHash: Hex;
let server: Server<undefined> | undefined;
let handle: RunnerHandle | undefined;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;

async function boot(known: readonly { chainId: number; escrow: Address }[] | null): Promise<void> {
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
  bonded = { ...base, bond: "100", reviewWindow: 3600 };
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
    ...(known === null ? {} : { funding: { known } }),
  });
  await handle.ready;
}

afterEach(async () => {
  handle?.stop();
  handle = undefined;
  if (server) await server.stop(true);
  server = undefined;
});

function terms(over: Partial<ReturnType<typeof baseTerms>> = {}) {
  return { ...baseTerms(), ...over };
}

function baseTerms() {
  return {
    buyer: FUNDER,
    payee: seller.address,
    amount: bonded.price,
    deadline: NOW + 120,
    salt: "4",
    bond: bonded.bond,
    reviewWindow: bonded.reviewWindow ?? 0,
  };
}

function frame(over: Record<string, unknown> = {}): Record<string, unknown> {
  const nextTerms = (over.terms as ReturnType<typeof baseTerms> | undefined) ?? baseTerms();
  const offerHash = (over.offerHash as Hex | undefined) ?? bondedHash;
  const chainId = (over.chainId as number | undefined) ?? CHAIN_ID;
  const escrow = (over.escrow as Address | undefined) ?? ESCROW;
  const jobId =
    (over.jobId as Hex | undefined) ?? jobIdOf({ offerHash, ...nextTerms }, chainId, escrow);
  return {
    t: "lock",
    jobId,
    offerHash,
    escrow,
    chainId,
    bond: bonded.bond,
    funder: FUNDER,
    terms: nextTerms,
    ...over,
  };
}

function sendFrame(body: Record<string, unknown>): Promise<RunnerToHub> {
  if (!socket) throw new Error("the hub is not connected");
  const reply = new Promise<RunnerToHub>((resolve) => {
    pending = resolve;
  });
  socket.send(JSON.stringify(body));
  return reply;
}

async function expectRefusal(body: Record<string, unknown>, reason: string): Promise<void> {
  const reply = await sendFrame(body);
  expect(reply.t).toBe("lock-refused");
  if (reply.t !== "lock-refused") throw new Error(`expected lock-refused, got ${reply.t}`);
  expect(reply.reason).toBe(reason);
}

const PINNED = [{ chainId: CHAIN_ID, escrow: ESCROW }] as const;

describe("the runner locks a bond only for a job it rebuilds", () => {
  test("a pinned escrow and terms that hash to the job id lock, and the signature recovers to the seller", async () => {
    await boot(PINNED);
    const next = terms();
    const jobId = jobIdOf({ offerHash: bondedHash, ...next }, CHAIN_ID, ESCROW);
    expect(next.deadline).toBe(NOW + 120);
    const reply = await sendFrame(frame({ terms: next, jobId }));
    expect(reply.t).toBe("locked");
    if (reply.t !== "locked") throw new Error(`expected locked, got ${reply.t}`);
    const recovered = await recoverTypedDataAddress({
      ...lockTypedData(CHAIN_ID, ESCROW, jobId, FUNDER),
      signature: reply.sig,
    });
    expect(recovered).toBe(seller.address);
  });

  test("a deadline exactly 60 seconds out locks, and job id and payee match without case", async () => {
    await boot(PINNED);
    const next = terms({
      payee: seller.address.toLowerCase() as Address,
      deadline: NOW + 60,
    });
    const jobId = jobIdOf({ offerHash: bondedHash, ...next }, CHAIN_ID, ESCROW);
    const cased = `0x${jobId.slice(2).toUpperCase()}` as Hex;
    const reply = await sendFrame(frame({ terms: next, jobId: cased }));
    expect(reply.t).toBe("locked");
    if (reply.t !== "locked") throw new Error(`expected locked, got ${reply.t}`);
    const recovered = await recoverTypedDataAddress({
      ...lockTypedData(CHAIN_ID, ESCROW, jobId, FUNDER),
      signature: reply.sig,
    });
    expect(recovered).toBe(seller.address);
  });

  test("missing terms are lock-refused with bad-terms", async () => {
    await boot(PINNED);
    const body = frame();
    delete body.terms;
    await expectRefusal(body, "bad-terms");
  });

  test("a payee that is not this runner is lock-refused with not-payee", async () => {
    await boot(PINNED);
    await expectRefusal(frame({ terms: terms({ payee: OTHER_PAYEE }) }), "not-payee");
  });

  test("terms that differ from the served offer are lock-refused with terms-mismatch", async () => {
    await boot(PINNED);
    await expectRefusal(frame({ terms: terms({ amount: "999" }) }), "terms-mismatch");
    await expectRefusal(frame({ terms: terms({ bond: "99" }) }), "terms-mismatch");
    await expectRefusal(frame({ terms: terms({ reviewWindow: 60 }) }), "terms-mismatch");
  });

  test("a deadline under 60 seconds out is lock-refused with deadline-too-near", async () => {
    await boot(PINNED);
    await expectRefusal(frame({ terms: terms({ deadline: NOW + 59 }) }), "deadline-too-near");
  });

  test("an escrow this runner has not pinned is lock-refused with unknown-escrow", async () => {
    await boot(null);
    await expectRefusal(frame(), "unknown-escrow");
  });

  test("a pinned list that does not name this escrow is lock-refused with unknown-escrow", async () => {
    await boot([{ chainId: CHAIN_ID, escrow: OTHER_ESCROW }]);
    await expectRefusal(frame(), "unknown-escrow");
  });

  test("terms that do not hash to the named job id are lock-refused with job-mismatch", async () => {
    await boot(PINNED);
    await expectRefusal(frame({ jobId: INVENTED_JOB }), "job-mismatch");
  });
});
