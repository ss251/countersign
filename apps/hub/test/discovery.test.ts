import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { offerHash, type Offer, type PaymentRequired } from "../src/deps.ts";
import type {
  AgentCard,
  DiscoveryItem,
  DiscoveryList,
  SkillsIndex,
} from "../src/discovery.ts";
import {
  call,
  makeOffer,
  NOW,
  publishOk,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

interface BazaarExtension {
  info: {
    input: { type: string; bodyType: string; body: Record<string, unknown> };
  };
  schema: { properties: { input: { properties: { body?: unknown } } } };
}

interface OpenApiPost {
  summary?: string;
  requestBody?: {
    content?: { "application/json"?: { schema?: { properties?: { input?: unknown } } } };
  };
  responses?: {
    "200"?: {
      content?: {
        "application/json"?: { schema?: { properties?: { output?: unknown; slip?: unknown } } };
      };
    };
    "402"?: { headers?: Record<string, unknown> };
    "422"?: unknown;
    "503"?: unknown;
  };
  "x-x402-accepts"?: unknown;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, { get?: { summary?: string }; post?: OpenApiPost }>;
}

const skill = makeOffer({
  title: "Echo the question",
  summary: "Returns the question it was given.",
  upstream: { url: "https://example.test/echo", licence: "MIT" },
});

const other = makeOffer({
  title: "Weather lookup",
  summary: "Looks up the weather by city.",
  adapter: "mcp",
  price: "2500",
  rails: ["eip3009"],
});

describe("discovery", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(async () => {
    hub = startHub({
      rails: [new FakeRail("escrow"), new FakeRail("eip3009", "eip155:1874")],
    });
    runners = [];
    await publishOk(hub, skill);
    await publishOk(hub, other);
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("serves the Circle discovery shape", async () => {
    const body = await list(hub);

    expect(body.x402Version).toBe(2);
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 2 });
    expect(body.items).toHaveLength(2);

    const item = findItem(body, skill);
    expect(item.resource).toBe(`http://hub.test/offers/${offerHash(skill)}/call`);
    expect(item.type).toBe("http");
    expect(item.x402Version).toBe(2);
    expect(item.lastUpdated).toBe(new Date(NOW * 1000).toISOString());
    expect(item.accepts).toHaveLength(1);
    expect(item.accepts[0]?.amount).toBe(skill.price);
    expect(item.metadata.provider).toEqual({
      name: "countersign",
      website: "http://hub.test",
      docsUrl: "http://hub.test/openapi.json",
      description: "Escrowed, countersigned x402 calls to software that sells itself.",
      category: "INFRASTRUCTURE",
      tags: ["x402", "escrow", skill.adapter, ...skill.rails],
    });
    expect(item.metadata.path).toBe(`/offers/${offerHash(skill)}/call`);
    expect(item.metadata.method).toBe("POST");
    expect(item.metadata.description).toBe(skill.summary);
    expect(item.metadata.mimeType).toBe("application/json");
    expect(item.metadata.input).toEqual({
      type: "http",
      method: "POST",
      bodyType: "json",
      body: {
        type: "object",
        properties: { input: skill.input, lineage: { type: "array", items: { type: "string" } } },
        required: ["input"],
      },
    });
    expect(item.metadata.supportsCircleGateway).toBe(false);
    expect(item.metadata.output.schema).toEqual(skill.output);
    expect(item.metadata.offerHash).toBe(offerHash(skill));
    expect(item.metadata.upstream).toEqual(skill.upstream);
  });

  test("discovery accepts equal the unpaid call's 402 accepts", async () => {
    const hash = offerHash(skill);
    runners.push(await connect(hub, hash));

    const unpaid = await call(hub, hash, { q: "hello" });
    expect(unpaid.status).toBe(402);
    const required = (await unpaid.json()) as PaymentRequired;

    const item = findItem(await list(hub), skill);
    expect(item.accepts).toEqual(required.accepts);
  });

  test("paginates and filters by title, summary and adapter", async () => {
    const page = (await fetch(`${hub.url}/discovery/resources?limit=1&offset=1`).then((r) =>
      r.json(),
    )) as DiscoveryList;
    expect(page.pagination).toEqual({ limit: 1, offset: 1, total: 2 });
    expect(page.items).toHaveLength(1);

    const byTitle = (await fetch(`${hub.url}/discovery/resources?query=weather`).then((r) =>
      r.json(),
    )) as DiscoveryList;
    expect(byTitle.pagination.total).toBe(1);
    expect(byTitle.items[0]?.metadata.offerHash).toBe(offerHash(other));

    const bySummary = (await fetch(`${hub.url}/discovery/resources?query=question`).then((r) =>
      r.json(),
    )) as DiscoveryList;
    expect(bySummary.pagination.total).toBe(1);
    expect(bySummary.items[0]?.metadata.offerHash).toBe(offerHash(skill));

    const byAdapter = (await fetch(`${hub.url}/discovery/resources?query=MCP`).then((r) =>
      r.json(),
    )) as DiscoveryList;
    expect(byAdapter.pagination.total).toBe(1);
    expect(byAdapter.items[0]?.metadata.offerHash).toBe(offerHash(other));
  });

  test("a query holding a resource URL finds that offer, as circle services inspect asks", async () => {
    const hash = offerHash(other);
    const url = `http://hub.test/offers/${hash}/call`;
    const found = (await fetch(
      `${hub.url}/discovery/resources?query=${encodeURIComponent(url)}&limit=1&siwx=false`,
    ).then((r) => r.json())) as DiscoveryList;
    expect(found.items.map((item) => item.resource)).toEqual([url]);
  });

  test("filters by category and type the way Circle's catalogue does", async () => {
    const get = async (qs: string) =>
      ((await fetch(`${hub.url}/discovery/resources?${qs}`).then((r) => r.json())) as DiscoveryList)
        .pagination.total;
    expect(await get("category=infrastructure")).toBe(2);
    expect(await get("category=WEB_SEARCH_RESEARCH")).toBe(0);
    expect(await get("type=http")).toBe(2);
    expect(await get("type=mcp")).toBe(0);
  });

  test("an unpaid call with the advertised example body reaches the 402", async () => {
    const hash = offerHash(skill);
    runners.push(await connect(hub, hash));
    const first = await call(hub, hash, { q: "hello" });
    const bazaar = ((await first.json()) as PaymentRequired).extensions?.bazaar as BazaarExtension;

    const response = await fetch(`${hub.url}/offers/${hash}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bazaar.info.input.body),
    });
    expect(response.status).toBe(402);
  });

  test("the 402 body carries the bazaar extension", async () => {
    const hash = offerHash(skill);
    runners.push(await connect(hub, hash));

    const response = await call(hub, hash, { q: "hello" });
    expect(response.status).toBe(402);
    const body = (await response.json()) as PaymentRequired;

    const bazaar = body.extensions?.bazaar as BazaarExtension | undefined;
    expect(bazaar).toBeDefined();
    expect(bazaar?.info.input.type).toBe("http");
    expect(bazaar?.info.input.bodyType).toBe("json");
    expect(bazaar?.info.input.body).toEqual({ input: { q: "example" } });
    expect(bazaar?.schema.properties.input.properties.body).toEqual(
      findItem(await list(hub), skill).metadata.input.body,
    );
  });

  test("the agent card lists one skill per offer and both paths serve it", async () => {
    const response = await fetch(`${hub.url}/.well-known/agent-card.json`);
    const alias = await fetch(`${hub.url}/.well-known/agent.json`);
    expect(response.status).toBe(200);
    expect(alias.status).toBe(200);

    const card = (await response.json()) as AgentCard;
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.name).toBe("countersign hub");
    expect(card.url).toBe("http://hub.test");
    expect(card.version).toBe("0.1.0");
    expect(card.provider).toEqual({ organization: "countersign", url: "http://hub.test" });
    expect(card.capabilities).toEqual({ streaming: false, pushNotifications: false });
    expect(card.defaultInputModes).toEqual(["application/json"]);
    expect(card.defaultOutputModes).toEqual(["application/json"]);
    expect(card.additionalInterfaces).toEqual([
      { url: "http://hub.test/discovery/resources", transport: "x402-bazaar" },
      { url: "http://hub.test/openapi.json", transport: "openapi" },
    ]);
    expect(card.skills).toHaveLength(2);
    expect(card.skills.map((entry) => entry.id).sort()).toEqual(
      [offerHash(skill), offerHash(other)].sort(),
    );
    expect(card.skills.find((entry) => entry.id === offerHash(other))?.tags).toEqual([
      "mcp",
      "eip3009",
    ]);

    expect(await alias.json()).toEqual(card);
  });

  test("the skills index lists only the skill offer", async () => {
    const response = await fetch(`${hub.url}/.well-known/skills/index.json`);
    expect(response.status).toBe(200);

    const index = (await response.json()) as SkillsIndex;
    expect(index.version).toBe(1);
    expect(index.skills).toHaveLength(1);

    const entry = index.skills[0];
    expect(entry?.offerHash).toBe(offerHash(skill));
    expect(entry?.name).toBe(skill.title);
    expect(entry?.description).toBe(skill.summary);
    expect(entry?.price).toEqual({ amount: skill.price, decimals: 6, currency: "USD stablecoin" });
    expect(entry?.call).toBe(`http://hub.test/offers/${offerHash(skill)}/call`);
    expect(entry?.upstream).toEqual(skill.upstream);
    expect(entry?.rails).toEqual(skill.rails);
  });

  test("the OpenAPI document describes the generic call and every offer", async () => {
    const response = await fetch(`${hub.url}/openapi.json`);
    expect(response.status).toBe(200);

    const doc = (await response.json()) as OpenApiDocument;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "http://hub.test" }]);
    expect(doc.info.title).toBe("countersign hub");
    expect(doc.paths["/offers/{offerHash}/call"]?.post).toBeDefined();
    expect(doc.paths["/offers/{offerHash}/call"]?.post?.responses?.["402"]).toBeDefined();

    const explicit = doc.paths[`/offers/${offerHash(skill)}/call`]?.post;
    expect(explicit?.summary).toBe(skill.title);
    expect(explicit?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.output).toEqual(
      skill.output,
    );
    expect(explicit?.requestBody?.content?.["application/json"]?.schema?.properties?.input).toEqual(
      skill.input,
    );
    expect(explicit?.["x-x402-accepts"]).toEqual(findItem(await list(hub), skill).accepts);

    expect(doc.paths[`/offers/${offerHash(other)}/call`]?.post?.summary).toBe(other.title);
  });

  test("a delisted offer appears nowhere", async () => {
    const hash = offerHash(skill);
    hub.store.delistOffer(hash, NOW);

    const body = await list(hub);
    expect(body.pagination.total).toBe(1);
    expect(body.items.map((entry) => entry.metadata.offerHash)).toEqual([offerHash(other)]);

    const card = (await fetch(`${hub.url}/.well-known/agent-card.json`).then((r) =>
      r.json(),
    )) as AgentCard;
    expect(card.skills.map((entry) => entry.id)).toEqual([offerHash(other)]);

    const index = (await fetch(`${hub.url}/.well-known/skills/index.json`).then((r) =>
      r.json(),
    )) as SkillsIndex;
    expect(index.skills).toHaveLength(0);

    const doc = (await fetch(`${hub.url}/openapi.json`).then((r) =>
      r.json(),
    )) as OpenApiDocument;
    expect(doc.paths[`/offers/${hash}/call`]).toBeUndefined();
    expect(doc.paths[`/offers/${offerHash(other)}/call`]).toBeDefined();
  });
});

async function list(hub: TestHub): Promise<DiscoveryList> {
  const response = await fetch(`${hub.url}/discovery/resources`);
  expect(response.status).toBe(200);
  return (await response.json()) as DiscoveryList;
}

function findItem(body: DiscoveryList, offer: Offer): DiscoveryItem {
  const item = body.items.find((entry) => entry.metadata.offerHash === offerHash(offer));
  if (!item) throw new Error("offer missing from discovery");
  return item;
}

async function connect(hub: TestHub, hash: Hex): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond: async () => ({ output: { q: "hello" } }),
  });
  await runner.ready;
  return runner;
}
