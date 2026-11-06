import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  delistMessage,
  PAYMENT_REQUIRED_HEADER,
  type ErrorBody,
} from "../src/deps.ts";
import type { AgentCard, DiscoveryList, SkillsIndex } from "../src/discovery.ts";
import {
  call,
  makeOffer,
  NOW,
  other,
  publish,
  publishOk,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

interface OpenApiDocument {
  paths: Record<string, unknown>;
}

describe("delisting", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub();
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("the seller delists its offer", async () => {
    const hash = await publishOk(hub, makeOffer());

    const response = await delist(hub, hash);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ offerHash: hash, status: "delisted" });

    const shown = await fetch(`${hub.url}/offers/${hash}`);
    expect(shown.status).toBe(200);
    expect(((await shown.json()) as { status: string }).status).toBe("delisted");
  });

  test("a delisted offer is not served or sold", async () => {
    const offer = makeOffer();
    const hash = await publishOk(hub, offer);
    runners.push(await connect(hub, hash));

    expect((await delist(hub, hash)).status).toBe(200);

    const listed = (await fetch(`${hub.url}/offers`).then((r) => r.json())) as {
      offers: Array<{ offerHash: string }>;
    };
    expect(listed.offers.map((entry) => entry.offerHash)).not.toContain(hash);

    const searched = (await fetch(
      `${hub.url}/offers/search?q=${encodeURIComponent(offer.title)}`,
    ).then((r) => r.json())) as { results: Array<{ offerHash: string }> };
    expect(searched.results.map((entry) => entry.offerHash)).not.toContain(hash);

    const discovery = (await fetch(`${hub.url}/discovery/resources`).then((r) =>
      r.json(),
    )) as DiscoveryList;
    expect(discovery.items.map((entry) => entry.metadata.offerHash)).not.toContain(hash);

    const card = (await fetch(`${hub.url}/.well-known/agent-card.json`).then((r) =>
      r.json(),
    )) as AgentCard;
    expect(card.skills.map((entry) => entry.id)).not.toContain(hash);

    const index = (await fetch(`${hub.url}/.well-known/skills/index.json`).then((r) =>
      r.json(),
    )) as SkillsIndex;
    expect(index.skills.map((entry) => entry.offerHash)).not.toContain(hash);

    const doc = (await fetch(`${hub.url}/openapi.json`).then((r) => r.json())) as OpenApiDocument;
    expect(doc.paths[`/offers/${hash}/call`]).toBeUndefined();

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).code).toBe("unknown-offer");
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
  });

  test("a delist signed by another key is refused", async () => {
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash));

    const response = await delist(hub, hash, other);
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");

    const listed = (await fetch(`${hub.url}/offers`).then((r) => r.json())) as {
      offers: Array<{ offerHash: string }>;
    };
    expect(listed.offers.map((entry) => entry.offerHash)).toContain(hash);

    const paid = await call(hub, hash, { q: "hello" });
    expect(paid.status).toBe(402);
  });

  test("bad delist requests are refused", async () => {
    const hash = await publishOk(hub, makeOffer());
    const unknown = `0x${"cd".repeat(32)}` as Hex;

    expect((await delist(hub, unknown)).status).toBe(404);

    const missing = await fetch(`${hub.url}/offers/${hash}/delist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as ErrorBody).code).toBe("bad-request");
  });

  test("delisting twice is idempotent", async () => {
    const hash = await publishOk(hub, makeOffer());

    expect((await delist(hub, hash)).status).toBe(200);
    const second = await delist(hub, hash);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ offerHash: hash, status: "delisted" });
  });

  test("republishing the same offer leaves it delisted", async () => {
    const offer = makeOffer();
    const hash = await publishOk(hub, offer);
    expect((await delist(hub, hash)).status).toBe(200);

    const again = await publish(hub, offer);
    expect(again.status).toBe(200);

    const shown = (await fetch(`${hub.url}/offers/${hash}`).then((r) => r.json())) as {
      status: string;
    };
    expect(shown.status).toBe("delisted");

    const listed = (await fetch(`${hub.url}/offers`).then((r) => r.json())) as {
      offers: Array<{ offerHash: string }>;
    };
    expect(listed.offers.map((entry) => entry.offerHash)).not.toContain(hash);
  });

  async function delist(
    target: TestHub,
    hash: Hex,
    signer: typeof seller | typeof other = seller,
  ): Promise<Response> {
    const sig = await signer.signMessage({ message: delistMessage(hash) });
    return fetch(`${target.url}/offers/${hash}/delist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sig }),
    });
  }

  async function connect(target: TestHub, hash: Hex): Promise<RunnerHandle> {
    const runner = startRunner({
      url: wsUrl(target),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: "hello" } }),
    });
    await runner.ready;
    return runner;
  }
});
