/**
 * 8 · Discovery from a clean client. The suite's own hub with one online offer, and the public
 * hub when one is configured, are read with plain HTTP and nothing else: no cookies, no state,
 * no SDK. Every offer hash is recomputed here from the offer itself.
 */

import {
  canonicalHash,
  canonicalJson,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  type Offer,
  type PaymentRequired,
} from "@countersign/core";
import { startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { PRICE } from "./arc-spine.flow.ts";

interface Listing {
  offerHash: string;
  offer: Offer;
  online: boolean;
  status: string;
}

const trim = (u: string) => u.replace(/\/+$/, "");

async function getOk(ctx: FlowCtx, label: string, url: string): Promise<unknown> {
  const res = await ctx.http(label, url);
  equal(res.status, 200, `${label} status`);
  check(res.json !== undefined, `${label} is JSON`);
  return res.json;
}

async function checkTarget(ctx: FlowCtx, name: string, base: string, expectOffer?: string): Promise<void> {
  const root = trim(base);
  const at = (p: string) => `${root}${p}`;

  await ctx.step(`${name} · healthz`, async () => {
    const h = (await getOk(ctx, `${name} healthz`, at("/healthz"))) as { ok?: boolean; rails?: unknown[] };
    equal(h.ok, true, "healthz ok");
    check(Array.isArray(h.rails), "healthz lists rails");
  });

  const offers = await ctx.step(`${name} · offer list`, async () => {
    const body = (await getOk(ctx, `${name} offers`, at("/offers"))) as { offers?: Listing[] };
    check(Array.isArray(body.offers), "offers is a list");
    for (const l of body.offers) sameHex(canonicalHash(l.offer), l.offerHash, `offer ${l.offerHash.slice(0, 10)} hashes to its offerHash`);
    if (expectOffer) {
      const mine = body.offers.find((l) => l.offerHash.toLowerCase() === expectOffer.toLowerCase());
      check(mine, `the offer list includes ${expectOffer.slice(0, 10)}`);
      equal(mine.status, "listed", "offer status");
      equal(mine.online, true, "offer online");
    }
    if (body.offers.length === 0) ctx.note(`${name} hub lists no offers`);
    return body.offers;
  });
  const listed = offers.filter((l) => l.status === "listed");

  await ctx.step(`${name} · A2A agent card`, async () => {
    const card = (await getOk(ctx, `${name} agent-card`, at("/.well-known/agent-card.json"))) as {
      name?: string;
      url?: string;
      protocolVersion?: string;
      skills?: { id: string }[];
      additionalInterfaces?: { url: string; transport: string }[];
    };
    const alias = await getOk(ctx, `${name} agent.json`, at("/.well-known/agent.json"));
    equal(canonicalJson(alias), canonicalJson(card), "agent.json equals agent-card.json");
    check(typeof card.name === "string" && card.name.length > 0, "the card has a name");
    check(typeof card.protocolVersion === "string", "the card has a protocol version");
    equal(trim(card.url ?? ""), root, "the card names this hub's public URL");
    check(Array.isArray(card.skills), "the card lists skills");
    for (const l of listed) {
      check(card.skills.some((s) => s.id.toLowerCase() === l.offerHash.toLowerCase()), `the card lists offer ${l.offerHash.slice(0, 10)}`);
    }
    for (const i of card.additionalInterfaces ?? []) {
      const res = await ctx.http(`${name} interface ${i.transport}`, i.url);
      equal(res.status, 200, `advertised interface ${i.transport} at ${i.url}`);
    }
  });

  await ctx.step(`${name} · skills index`, async () => {
    const idx = (await getOk(ctx, `${name} skills index`, at("/.well-known/skills/index.json"))) as {
      version?: number;
      skills?: { offerHash: string; call: string; price: { amount: string; decimals: number } }[];
    };
    equal(idx.version, 1, "skills index version");
    check(Array.isArray(idx.skills), "skills index lists skills");
    for (const l of listed.filter((x) => x.offer.adapter === "skill")) {
      const s = idx.skills.find((x) => x.offerHash.toLowerCase() === l.offerHash.toLowerCase());
      check(s, `skills index lists ${l.offerHash.slice(0, 10)}`);
      equal(s.call, `${root}/offers/${l.offerHash}/call`, "skills index call URL");
      equal(s.price.amount, l.offer.price, "skills index price");
      equal(s.price.decimals, 6, "skills index price decimals");
    }
  });

  await ctx.step(`${name} · OpenAPI`, async () => {
    const doc = (await getOk(ctx, `${name} openapi`, at("/openapi.json"))) as {
      openapi?: string;
      servers?: { url: string }[];
      paths?: Record<string, unknown>;
    };
    check(typeof doc.openapi === "string" && doc.openapi.startsWith("3.1"), `OpenAPI version ${doc.openapi}`);
    equal(trim(doc.servers?.[0]?.url ?? ""), root, "OpenAPI server URL");
    check(doc.paths && "/offers/{offerHash}/call" in doc.paths, "OpenAPI documents the call path");
    for (const l of listed) check(`/offers/${l.offerHash}/call` in (doc.paths ?? {}), `OpenAPI has a path for ${l.offerHash.slice(0, 10)}`);
  });

  await ctx.step(`${name} · Bazaar list`, async () => {
    type BazaarList = { x402Version?: number; items?: { resource: string; accepts: { amount: string }[]; metadata: { offerHash: string; method: string } }[]; pagination?: { total: number } };
    // Circle's catalogue shape is flat. Hubs deployed before #25 wrapped it in `data`.
    const raw = (await getOk(ctx, `${name} discovery resources`, at("/discovery/resources?limit=200"))) as BazaarList & { data?: BazaarList };
    const res = raw.data ?? raw;
    equal(res.x402Version, 2, "Bazaar x402 version");
    const items = res.items;
    check(Array.isArray(items), "Bazaar lists items");
    for (const item of items) {
      equal(item.resource, `${root}/offers/${item.metadata.offerHash}/call`, "Bazaar resource URL");
      equal(item.metadata.method, "POST", "Bazaar method");
    }
    if (expectOffer) {
      const mine = items.find((i) => i.metadata.offerHash.toLowerCase() === expectOffer.toLowerCase());
      check(mine, `Bazaar lists ${expectOffer.slice(0, 10)}`);
      check(mine.accepts.length > 0, "Bazaar item accepts a rail");
      equal(mine.accepts[0]?.amount, PRICE.toString(), "Bazaar item price");
    }
  });

  // A skill offer takes the empty input; other adapters (an MCP tool) need their own arguments.
  const online = expectOffer
    ? listed.find((l) => l.offerHash.toLowerCase() === expectOffer.toLowerCase())
    : listed.find((l) => l.online && l.offer.adapter === "skill");
  if (!online) {
    ctx.note(`${name} hub has no online skill offer, so the unpaid-call check did not run there`);
    return;
  }
  await ctx.step(`${name} · unpaid call answers 402`, async () => {
    const res = await ctx.http(`${name} unpaid call`, at(`/offers/${online.offerHash}/call`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    equal(res.status, 402, "unpaid call status");
    const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
    check(header, "402 carries PAYMENT-REQUIRED");
    const required = fromBase64Json<PaymentRequired>(header);
    equal(canonicalJson(required), canonicalJson(res.json), "PAYMENT-REQUIRED header equals the body");
    equal(required.x402Version, 2, "x402 version");
    check(required.accepts.length > 0, "the 402 accepts at least one rail");
    check(required.extensions && "bazaar" in required.extensions, "the 402 carries the bazaar extension");
  });
}

export const discovery: Flow = {
  name: "discovery",
  title: "Discovery from a clean client",
  owner: "orch-cs",
  network: "none",
  async run(ctx) {
    const hub = await ctx.step("local hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step("seller publishes use-arc", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );
    await checkTarget(ctx, "local", hub.url, seller.offerHash);
    const pub = ctx.env.options.publicHub;
    if (pub) await checkTarget(ctx, "public", pub);
    else ctx.note("no public hub configured (E2E_PUBLIC_HUB or --public-hub)");
  },
};
