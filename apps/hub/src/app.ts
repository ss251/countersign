import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import {
  assertOffer,
  assertSchema,
  offerHash,
  publishMessage,
  RUNNER_PATH,
  type ErrorBody,
  type Offer,
  type PublishRequest,
} from "./deps.ts";
import { recoverMessageAddress, type Hex } from "viem";
import type { Rail } from "./deps.ts";
import { paidCall } from "./call.ts";
import { agentCard, listResources, skillsIndex } from "./discovery.ts";
import { listSellers, listSettlements, searchOffers, type FrontdoorDeps } from "./frontdoor.ts";
import type { IdentityLookup } from "./identity.ts";
import { openapiDocument } from "./openapi.ts";
import { Ratings } from "./ratings.ts";
import { RunnerLink } from "./runners.ts";
import { Store } from "./store.ts";
import type { Listing } from "./types.ts";

export interface HubDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
  publicUrl: string;
  jobTimeoutMs?: number;
  identity?: IdentityLookup;
  /** How long /ratings, /ratings/:seller and /stats reuse one computed snapshot. Default 5 seconds. */
  ratingsCacheSeconds?: number;
}

const PAYMENT_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"];

export function createHub(deps: HubDeps) {
  const app = new Hono();
  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const runners = new RunnerLink(deps.store);
  const ratings = new Ratings(deps.store, { now: deps.now, cacheSeconds: deps.ratingsCacheSeconds ?? 5 });
  const frontdoor = (): FrontdoorDeps => {
    const view: FrontdoorDeps = {
      store: deps.store,
      rails: deps.rails,
      isOnline: (offerHash) => runners.isOnline(offerHash),
    };
    if (deps.identity) view.identity = deps.identity;
    return view;
  };

  app.use("*", cors({ origin: "*", exposeHeaders: PAYMENT_HEADERS }));

  app.get("/healthz", (c) =>
    json({
      ok: true,
      rails: deps.rails.map((rail) => rail.declaration),
      runners: runners.count,
    }),
  );

  app.post("/offers", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      return fail(400, "bad-offer", "Refused. The offer is malformed.");
    }
    if (!isRecord(body)) return fail(400, "bad-offer", "Refused. The offer is malformed.");

    const request = body as unknown as PublishRequest;
    try {
      assertOffer(request.offer);
      assertSchema(request.offer.input);
      assertSchema(request.offer.output);
    } catch {
      return fail(400, "bad-offer", "Refused. The offer is malformed.");
    }
    if (typeof request.sig !== "string") {
      return fail(401, "bad-signature", "Refused. The offer signature is not the seller's.");
    }

    const hash = offerHash(request.offer);
    let signer: string;
    try {
      signer = await recoverMessageAddress({
        message: publishMessage(hash),
        signature: request.sig,
      });
    } catch {
      return fail(401, "bad-signature", "Refused. The offer signature is not the seller's.");
    }
    if (signer.toLowerCase() !== request.offer.seller.toLowerCase()) {
      return fail(401, "bad-signature", "Refused. The offer signature is not the seller's.");
    }

    const fresh = deps.store.putOffer(hash, request.offer.seller, request.offer, deps.now());
    return json({ offerHash: hash }, fresh ? 201 : 200);
  });

  app.get("/offers", (c) =>
    json({
      offers: deps.store.listOffers().map((stored) => listing(stored, runners)),
    }),
  );

  app.get("/offers/search", (c) =>
    json(
      searchOffers(frontdoor(), {
        q: c.req.query("q"),
        limit: c.req.query("limit"),
        rail: c.req.query("rail"),
        maxPrice: c.req.query("maxPrice"),
      }),
    ),
  );

  app.get("/offers/:offerHash", (c) => {
    const stored = deps.store.getOffer(c.req.param("offerHash"));
    if (!stored) return fail(404, "unknown-offer", "Refused. That offer is not known.");
    return json(listing(stored, runners));
  });

  app.get("/sellers", async (c) => json(await listSellers(frontdoor())));

  app.get("/settlements", (c) =>
    json(listSettlements(frontdoor(), { limit: c.req.query("limit") })),
  );

  app.get("/rails", (c) => json({ rails: deps.rails.map((rail) => rail.declaration) }));

  app.get("/discovery/resources", (c) =>
    json(
      listResources(deps, {
        limit: c.req.query("limit"),
        offset: c.req.query("offset"),
        query: c.req.query("query"),
      }),
    ),
  );

  app.get("/.well-known/agent-card.json", (c) => json(agentCard(deps)));
  app.get("/.well-known/agent.json", (c) => json(agentCard(deps)));
  app.get("/.well-known/skills/index.json", (c) => json(skillsIndex(deps)));
  app.get("/openapi.json", (c) => json(openapiDocument(deps)));

  app.get("/slips/:slipHash", (c) => {
    const slip = deps.store.getSlip(c.req.param("slipHash"));
    if (!slip) return fail(404, "unknown-slip", "Refused. That slip is not known.");
    return json(slip);
  });

  app.get("/ratings", async () => json({ ratings: await ratings.all() }));

  app.get("/ratings/:seller", async (c) => {
    const rating = await ratings.seller(c.req.param("seller"));
    if (!rating) return fail(404, "unknown-seller", "Refused. That seller has no offers here.");
    return json(rating);
  });

  app.get("/stats", async () => json(await ratings.stats(runners.count)));

  app.get("/jobs/:jobId", (c) => {
    const job = deps.store.getJob(c.req.param("jobId"));
    if (!job) return fail(404, "unknown-job", "Refused. That job is not known.");
    return json({
      jobId: job.jobId,
      offerHash: job.offerHash,
      rail: job.rail,
      status: job.status,
      deadline: job.deadline,
      settleTx: job.settleTx,
      closeTx: job.closeTx,
      slipHash: job.slipHash,
    });
  });

  app.get(RUNNER_PATH, upgradeWebSocket(() => runners.events()));

  app.post("/offers/:offerHash/call", async (c) => {
    const hash = c.req.param("offerHash");
    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      return fail(400, "bad-payment", "Refused. The request body does not decode.");
    }

    let outcome;
    try {
      outcome = await paidCall({ ...deps, runners }, hash, c.req.raw.headers, body);
    } catch {
      return fail(500, "internal", "Refused. The hub could not complete the call.");
    }
    console.log(`[hub] call ${hash} rail=${outcome.railId ?? "none"} status=${outcome.status}`);
    return json(outcome.body, outcome.status, outcome.headers);
  });

  return { app, websocket, runners };
}

function listing(
  stored: { offerHash: Hex; offer: Offer; delistedAt: number | null },
  runners: RunnerLink,
): Listing {
  return {
    offerHash: stored.offerHash,
    offer: stored.offer,
    online: runners.isOnline(stored.offerHash),
    status: stored.delistedAt === null ? "listed" : "delisted",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const merged = new Headers(headers);
  merged.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: merged });
}

function fail(status: number, code: string, message: string): Response {
  const body: ErrorBody = { code, message };
  return json(body, status);
}
