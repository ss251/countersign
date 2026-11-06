import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runnerAuthMessage } from "../src/deps.ts";
import {
  makeOffer,
  other,
  publishOk,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner } from "./runner-client.ts";

describe("runner link", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("a hello signed by another key is rejected and never comes online", async () => {
    const hash = await publishOk(hub, makeOffer());
    const socket = new WebSocket(wsUrl(hub));

    const challenge = await new Promise<{ nonce: string }>((resolve, reject) => {
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as { t: string; nonce?: string };
        if (frame.t === "challenge" && typeof frame.nonce === "string") resolve({ nonce: frame.nonce });
      };
      socket.onerror = () => reject(new Error("socket error"));
    });

    const sig = await other.signMessage({ message: runnerAuthMessage(challenge.nonce) });

    const errorFrame = new Promise<string>((resolve) => {
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as { t: string; message?: string };
        if (frame.t === "error" && typeof frame.message === "string") resolve(frame.message);
      };
    });
    const closed = new Promise<void>((resolve) => {
      socket.onclose = () => resolve();
    });

    socket.send(
      JSON.stringify({
        t: "hello",
        seller: seller.address,
        offers: [hash],
        nonce: challenge.nonce,
        sig,
      }),
    );

    const message = await errorFrame;
    expect(message.startsWith("Refused.")).toBe(true);
    await closed;
    expect(hub.runners.isOnline(hash)).toBe(false);
    expect(hub.runners.count).toBe(0);
  });

  test("a runner cannot claim another seller's offer", async () => {
    const hash = await publishOk(hub, makeOffer());
    const runner = startRunner({
      url: wsUrl(hub),
      account: other,
      offers: [hash],
      now: () => 1_700_000_000,
      respond: async () => ({ output: { q: "hello" } }),
    });

    const accepted = await runner.ready;
    expect(accepted).toEqual([]);
    expect(hub.runners.isOnline(hash)).toBe(false);

    const listing = (await fetch(`${hub.url}/offers/${hash}`).then((r) => r.json())) as {
      online: boolean;
    };
    expect(listing.online).toBe(false);
    runner.close();
  });
});
