import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { join } from "node:path";
import {
  canaryMessage,
  offerHash as hashOffer,
  RUNNER_PATH,
  runnerAuthMessage,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import { startRunner, type RunnerHandle } from "../src/daemon.ts";
import { readSkill, skillOffer } from "../src/skill.ts";
import type { Hex, RunnerAccount } from "../src/account.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const NONCE = "0123456789abcdef0123456789abcdef";
const NOW = 1_700_000_000;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");

const viem: Viem = await loadViem();

let seller: RunnerAccount;
let offer: Offer;
let offerHash: Hex;
let server: Server<undefined>;
let handle: RunnerHandle;
let socket: ServerWebSocket<undefined> | null;
let pending: ((message: RunnerToHub) => void) | null;

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
  socket = null;
  pending = null;

  let resolveHello: () => void = () => undefined;
  const helloChecked = new Promise<void>((resolve) => {
    resolveHello = resolve;
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
            .then(() => {
              ws.send(JSON.stringify({ t: "ready", seller: seller.address, offers: [offerHash] }));
              resolveHello();
            });
          return;
        }
        if (message.t === "canary" || message.t === "canary-fail") {
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
    now: () => NOW,
  });

  await helloChecked;
  await handle.ready;
});

afterEach(async () => {
  handle.stop();
  await server.stop(true);
});

describe("canary", () => {
  test("answers for a served offer with the seller's signature", async () => {
    const nonce = "0xcanary-nonce";
    const reply = await sendCanary(offerHash, nonce);
    if (reply.t !== "canary") throw new Error(`expected canary, got ${reply.t}`);

    expect(reply.offerHash.toLowerCase()).toBe(offerHash.toLowerCase());
    expect(reply.nonce).toBe(nonce);
    const signer = await viem.recoverMessageAddress({
      message: canaryMessage(offerHash, nonce),
      signature: reply.sig,
    });
    expect(signer.toLowerCase()).toBe(seller.address.toLowerCase());
  });

  test("refuses a canary for an offer it does not serve", async () => {
    const other = `0x${"cd".repeat(32)}` as Hex;
    const reply = await sendCanary(other, "0xother-nonce");
    if (reply.t !== "canary-fail") throw new Error(`expected canary-fail, got ${reply.t}`);

    expect(reply.offerHash).toBe(other);
    expect(reply.reason).toBe("not-served");
  });
});

function sendCanary(hash: Hex, nonce: string): Promise<RunnerToHub> {
  if (!socket) throw new Error("the hub is not connected");
  const reply = new Promise<RunnerToHub>((resolve) => {
    pending = resolve;
  });
  socket.send(JSON.stringify({ t: "canary", offerHash: hash, nonce }));
  return reply;
}
