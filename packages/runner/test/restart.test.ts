import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import type { Server } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  offerHash as hashOffer,
  publishMessage,
  RUNNER_PATH,
  runnerAuthMessage,
  type Offer,
  type RunnerToHub,
} from "@countersign/core";
import type { Hex } from "../src/account.ts";
import { prepareServed, type Options } from "../src/cli.ts";
import { startRunner } from "../src/daemon.ts";
import { loadViem, type Viem } from "./viem.ts";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");
const START = 1_700_000_000;

const viem: Viem = await loadViem();
const account = viem.privateKeyToAccount(PRIVATE_KEY);

interface StoredOffer {
  offer: Offer;
}

interface Hello {
  offers: Hex[];
  accepted: Hex[];
}

const stored = new Map<string, StoredOffer>();
const published: Hex[] = [];
const hellos: Hello[] = [];
let nonces = 0;

const hub: Server<undefined> = Bun.serve({
  port: 0,
  async fetch(request, srv) {
    const path = new URL(request.url).pathname;
    if (path === RUNNER_PATH) {
      if (srv.upgrade(request)) return;
      return new Response("upgrade failed", { status: 500 });
    }
    if (path === "/offers" && request.method === "POST") {
      const body = (await request.json()) as { offer?: Offer; sig?: Hex };
      if (body.offer === undefined || typeof body.sig !== "string") {
        return Response.json({ message: "Refused. The offer is malformed." }, { status: 400 });
      }
      const offer = body.offer;
      const hash = hashOffer(offer);
      const signer = await viem.recoverMessageAddress({
        message: publishMessage(hash),
        signature: body.sig,
      });
      if (signer.toLowerCase() !== offer.seller.toLowerCase()) {
        return Response.json(
          { message: "Refused. The offer signature is not the seller's." },
          { status: 401 },
        );
      }
      stored.set(hash.toLowerCase(), { offer });
      published.push(hash);
      return Response.json({ offerHash: hash });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      nonces += 1;
      ws.send(JSON.stringify({ t: "challenge", nonce: `restart-${nonces}` }));
    },
    message(ws, raw) {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const message = JSON.parse(text) as RunnerToHub;
      if (message.t !== "hello") return;
      void (async () => {
        const signer = await viem.recoverMessageAddress({
          message: runnerAuthMessage(message.nonce),
          signature: message.sig,
        });
        if (signer.toLowerCase() !== message.seller.toLowerCase()) {
          ws.send(
            JSON.stringify({
              t: "error",
              message: "Refused. The runner signature is not the seller's.",
            }),
          );
          ws.close(1008, "bad-hello");
          return;
        }
        const accepted = message.offers.filter((hash) => {
          const entry = stored.get(hash.toLowerCase());
          return (
            entry !== undefined &&
            entry.offer.seller.toLowerCase() === message.seller.toLowerCase()
          );
        });
        hellos.push({ offers: [...message.offers], accepted });
        ws.send(JSON.stringify({ t: "ready", seller: message.seller, offers: accepted }));
      })();
    },
  },
});

const hubUrl = `http://127.0.0.1:${hub.port}`;

afterAll(async () => {
  setSystemTime();
  await hub.stop(true);
});

function options(state: string): Options {
  return { hub: hubUrl, skills: [FIXTURE], price: "1000", deadline: 120, rails: ["escrow"], state };
}

/** Publish and start once, as serveCommand does, and return what the hub saw. */
async function serveOnce(state: string): Promise<{ hashes: Hex[]; hello: Hello }> {
  const before = hellos.length;
  const { served, hashes } = await prepareServed(options(state), account);
  const handle = startRunner({ hubUrl, account, served });
  await handle.ready;
  handle.stop();
  const hello = hellos[before];
  if (hello === undefined) throw new Error("The hub did not record a hello.");
  return { hashes, hello };
}

describe("restart", () => {
  test("a restarted runner claims the offer the hub stored", async () => {
    const state = mkdtempSync(join(tmpdir(), "cs-runner-restart-"));

    setSystemTime(new Date(START * 1000));
    const first = await serveOnce(state);

    setSystemTime(new Date((START + 3600) * 1000));
    const second = await serveOnce(state);

    expect(first.hashes).toHaveLength(1);
    expect(first.hashes).toEqual(second.hashes);
    expect(second.hello.offers).toEqual(first.hello.offers);
    expect(second.hello.offers).toEqual(second.hashes);
    expect(second.hello.accepted).toEqual(second.hello.offers);

    const uniquePublished = new Set(published.map((hash) => hash.toLowerCase()));
    expect(uniquePublished.size).toBe(1);
    for (const hash of second.hashes) expect(stored.has(hash.toLowerCase())).toBe(true);
  });
});
