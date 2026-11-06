import { afterEach, describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import { recoverMessageAddress, type Hex } from "viem";
import { canaryMessage, offerHash, type HubToRunner, type RunnerToHub } from "@countersign/core";
import { JobRefusal, RunnerLink } from "../src/runner/link.ts";
import { signerFromKey } from "../src/runner/signer.ts";
import { offerFor } from "../src/runner/skills.ts";

const NOW = 1_800_000_000;

/**
 * A stand-in hub that sends canaries once the phone says hello, and records every frame the
 * phone sends, so the answer can be checked against the same code the runner daemon uses.
 */
describe("phone canary answers", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let link: RunnerLink | null = null;
  afterEach(() => {
    link?.stop();
    server?.stop(true);
    link = null;
    server = null;
  });

  test("an offer that is on answers with the seller's signature and is not served", async () => {
    const key = generatePrivateKey();
    const signer = signerFromKey(key);
    const offer = offerFor("phone-location", signer.address, NOW);
    const hash = offerHash(offer);
    const nonce = "phone-canary-nonce";
    const sent: string[] = [];
    let served = 0;

    server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 })),
      websocket: {
        open: (ws) => {
          ws.send(JSON.stringify({ t: "challenge", nonce: "phone-hello-nonce" } satisfies HubToRunner));
        },
        message: (ws, data) => {
          const text = String(data);
          sent.push(text);
          const frame = JSON.parse(text) as RunnerToHub;
          if (frame.t !== "hello") return;
          ws.send(JSON.stringify({ t: "ready", seller: signer.address, offers: [hash] } satisfies HubToRunner));
          ws.send(JSON.stringify({ t: "canary", offerHash: hash, nonce } satisfies HubToRunner));
        },
      },
    });

    link = new RunnerLink({
      hubUrl: `http://127.0.0.1:${server.port}`,
      signer,
      checkOrder: async () => null,
      now: () => NOW,
      skills: () => [
        {
          offer,
          hash,
          serve: async () => {
            served += 1;
            throw new JobRefusal("a canary must not serve");
          },
        },
      ],
    });
    link.start();
    await waitFor(() => sent.some((text) => (JSON.parse(text) as RunnerToHub).t === "canary"));

    const frames = sent.map((text) => JSON.parse(text) as RunnerToHub);
    const answer = frames.find((frame) => frame.t === "canary");
    if (answer?.t !== "canary") throw new Error("no canary answer");
    expect(answer.offerHash).toBe(hash);
    expect(answer.nonce).toBe(nonce);
    expect(
      await recoverMessageAddress({
        message: canaryMessage(hash, nonce),
        signature: answer.sig,
      }),
    ).toBe(signer.address);
    expect(served).toBe(0);

    const everything = sent.join("\n").toLowerCase();
    expect(everything.includes(key.slice(2).toLowerCase())).toBe(false);
  });

  test("an offer that is not on or not known is refused as not-served", async () => {
    const key = generatePrivateKey();
    const signer = signerFromKey(key);
    const onOffer = offerFor("phone-location", signer.address, NOW);
    const onHash = offerHash(onOffer);
    const offOffer = offerFor("phone-photo", signer.address, NOW);
    const offHash = offerHash(offOffer);
    const unknownHash = `0x${"44".repeat(32)}` as Hex;
    const offNonce = "phone-canary-off";
    const unknownNonce = "phone-canary-unknown";
    const sent: string[] = [];
    let served = 0;

    server = Bun.serve({
      port: 0,
      fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : new Response("no", { status: 400 })),
      websocket: {
        open: (ws) => {
          ws.send(JSON.stringify({ t: "challenge", nonce: "phone-hello-nonce" } satisfies HubToRunner));
        },
        message: (ws, data) => {
          const text = String(data);
          sent.push(text);
          const frame = JSON.parse(text) as RunnerToHub;
          if (frame.t !== "hello") return;
          ws.send(JSON.stringify({ t: "ready", seller: signer.address, offers: [onHash] } satisfies HubToRunner));
          ws.send(JSON.stringify({ t: "canary", offerHash: offHash, nonce: offNonce } satisfies HubToRunner));
          ws.send(JSON.stringify({ t: "canary", offerHash: unknownHash, nonce: unknownNonce } satisfies HubToRunner));
        },
      },
    });

    link = new RunnerLink({
      hubUrl: `http://127.0.0.1:${server.port}`,
      signer,
      checkOrder: async () => null,
      now: () => NOW,
      skills: () => [
        {
          offer: onOffer,
          hash: onHash,
          serve: async () => {
            served += 1;
            throw new JobRefusal("a canary must not serve");
          },
        },
      ],
    });
    link.start();
    await waitFor(
      () => sent.filter((text) => (JSON.parse(text) as RunnerToHub).t === "canary-fail").length === 2,
    );

    const frames = sent.map((text) => JSON.parse(text) as RunnerToHub);
    expect(frames).toContainEqual({
      t: "canary-fail",
      offerHash: offHash,
      nonce: offNonce,
      reason: "not-served",
    });
    expect(frames).toContainEqual({
      t: "canary-fail",
      offerHash: unknownHash,
      nonce: unknownNonce,
      reason: "not-served",
    });
    expect(served).toBe(0);

    const everything = sent.join("\n").toLowerCase();
    expect(everything.includes(key.slice(2).toLowerCase())).toBe(false);
  });
});

async function waitFor(done: () => boolean): Promise<void> {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > 3_000) throw new Error("timed out");
    await Bun.sleep(10);
  }
}
