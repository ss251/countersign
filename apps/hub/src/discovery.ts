import { declareDiscoveryExtension } from "@x402/extensions";
import type { Hex } from "viem";
import { GATEWAY_BATCHED, type JsonSchema, type Offer, type PaymentRequirements, type Rail, type RailId } from "./deps.ts";
import type { Store, StoredOffer } from "./store.ts";
import { isRecord } from "./util.ts";

export interface DiscoveryDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
  publicUrl: string;
}

export interface ChallengeOption {
  entry: PaymentRequirements;
  rail: Rail;
}

export interface DiscoveryProvider {
  name: string;
  website: string;
  docsUrl: string;
  description: string;
  category: string;
  tags: string[];
}

export interface DiscoveryMetadata {
  provider: DiscoveryProvider;
  path: string;
  method: "POST";
  description: string;
  mimeType: "application/json";
  /** The wire body of a call, `{input, lineage?}`, in Circle's catalogue form. */
  input: { type: "http"; method: "POST"; bodyType: "json"; body: JsonSchema };
  output: { schema: JsonSchema };
  /** True when one of `accepts` is a Circle Gateway batched payment. */
  supportsCircleGateway: boolean;
  offerHash: Hex;
  upstream?: { url: string; licence: string };
}

export interface DiscoveryItem {
  resource: string;
  type: "http";
  x402Version: 2;
  lastUpdated: string;
  accepts: PaymentRequirements[];
  metadata: DiscoveryMetadata;
}

/** The shape of Circle's public catalogue, read live on 06 Nov: no `data` wrapper. */
export interface DiscoveryList {
  x402Version: 2;
  items: DiscoveryItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface DiscoveryParams {
  limit?: string | undefined;
  offset?: string | undefined;
  query?: string | undefined;
  category?: string | undefined;
  type?: string | undefined;
}

const PROVIDER_DESCRIPTION = "Escrowed, countersigned x402 calls to software that sells itself.";
const CATEGORY = "INFRASTRUCTURE";

export function resourceFor(publicUrl: string, offerHash: Hex): string {
  return `${publicUrl}/offers/${offerHash}/call`;
}

/** Every configured rail the offer lists, in the offer's order. Shared by the 402 and discovery. */
export function challengeOptions(
  rails: Rail[],
  offer: Offer,
  resource: string,
  now: number,
): ChallengeOption[] {
  const configured = new Map<string, Rail>();
  for (const rail of rails) configured.set(rail.declaration.id, rail);
  const options: ChallengeOption[] = [];
  for (const id of offer.rails) {
    const rail = configured.get(id);
    if (!rail) continue;
    try {
      options.push({ entry: rail.challenge(offer, { resource, now }), rail });
    } catch (error) {
      // One broken rail must not take the 402 down. Never log the offer body.
      console.warn(`[hub] rail ${id} challenge failed: ${firstLine(error)}`);
    }
  }
  return options;
}

/** The first line of an error, safe to put in one log line or one refusal. */
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.slice(0, 300) || "unknown error";
}

export function acceptsFor(
  rails: Rail[],
  offer: Offer,
  resource: string,
  now: number,
): PaymentRequirements[] {
  return challengeOptions(rails, offer, resource, now).map((option) => option.entry);
}

export function exampleInput(schema: JsonSchema): Record<string, unknown> {
  const properties = schema.properties;
  const example: Record<string, unknown> = {};
  if (!isRecord(properties)) return example;
  for (const name of Object.keys(properties)) example[name] = "example";
  return example;
}

/** The JSON body a call actually sends: the offer's input wrapped as `{input, lineage?}`. */
export function callBodySchema(offer: Offer): JsonSchema {
  return {
    type: "object",
    properties: {
      input: offer.input,
      lineage: { type: "array", items: { type: "string" } },
    },
    required: ["input"],
  };
}

export function bazaarExtension(offer: Offer): Record<string, unknown> {
  return declareDiscoveryExtension({
    bodyType: "json",
    input: { input: exampleInput(offer.input) },
    inputSchema: callBodySchema(offer),
    output: { schema: offer.output },
  });
}

export function listResources(deps: DiscoveryDeps, params: DiscoveryParams): DiscoveryList {
  const now = deps.now();
  const limit = clamp(parseIntParam(params.limit, 50), 1, 200);
  const offset = parseIntParam(params.offset, 0);
  const query = (params.query ?? "").trim().toLowerCase();
  const category = (params.category ?? "").trim().toUpperCase();
  const type = (params.type ?? "").trim().toLowerCase();
  const listed =
    (category !== "" && category !== CATEGORY) || (type !== "" && type !== "http")
      ? []
      : deps.store.listOffers().filter((stored) => matches(stored, query));

  return {
    x402Version: 2,
    items: listed.slice(offset, offset + limit).map((stored) => itemFor(deps, stored, now)),
    pagination: { limit, offset, total: listed.length },
  };
}

export interface AgentSkill {
  id: Hex;
  name: string;
  description: string;
  tags: string[];
  inputModes: string[];
  outputModes: string[];
}

export interface AgentCard {
  protocolVersion: "0.3.0";
  name: string;
  description: string;
  url: string;
  version: "0.1.0";
  provider: { organization: string; url: string };
  capabilities: { streaming: false; pushNotifications: false };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  additionalInterfaces: Array<{ url: string; transport: string }>;
}

export function agentCard(deps: DiscoveryDeps): AgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "countersign hub",
    description: PROVIDER_DESCRIPTION,
    url: deps.publicUrl,
    version: "0.1.0",
    provider: { organization: "countersign", url: deps.publicUrl },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: deps.store.listOffers().map((stored) => ({
      id: stored.offerHash,
      name: stored.offer.title,
      description: stored.offer.summary || stored.offer.title,
      tags: [stored.offer.adapter, ...stored.offer.rails],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
    additionalInterfaces: [
      { url: `${deps.publicUrl}/discovery/resources`, transport: "x402-bazaar" },
      { url: `${deps.publicUrl}/openapi.json`, transport: "openapi" },
    ],
  };
}

export interface SkillEntry {
  name: string;
  description: string;
  offerHash: Hex;
  price: { amount: string; decimals: number; currency: string };
  call: string;
  upstream?: { url: string; licence: string };
  rails: RailId[];
}

export interface SkillsIndex {
  version: 1;
  skills: SkillEntry[];
}

export function skillsIndex(deps: DiscoveryDeps): SkillsIndex {
  return {
    version: 1,
    skills: deps.store
      .listOffers()
      .filter((stored) => stored.offer.adapter === "skill")
      .map((stored) => {
        const entry: SkillEntry = {
          name: stored.offer.title,
          description: stored.offer.summary,
          offerHash: stored.offerHash,
          price: { amount: stored.offer.price, decimals: 6, currency: "USD stablecoin" },
          call: resourceFor(deps.publicUrl, stored.offerHash),
          rails: stored.offer.rails,
        };
        if (stored.offer.upstream) entry.upstream = stored.offer.upstream;
        return entry;
      }),
  };
}

function itemFor(deps: DiscoveryDeps, stored: StoredOffer, now: number): DiscoveryItem {
  const path = `/offers/${stored.offerHash}/call`;
  const resource = `${deps.publicUrl}${path}`;
  const metadata: DiscoveryMetadata = {
    provider: {
      name: "countersign",
      website: deps.publicUrl,
      docsUrl: `${deps.publicUrl}/openapi.json`,
      description: PROVIDER_DESCRIPTION,
      category: CATEGORY,
      tags: ["x402", "escrow", stored.offer.adapter, ...stored.offer.rails],
    },
    path,
    method: "POST",
    description: stored.offer.summary || stored.offer.title,
    mimeType: "application/json",
    input: { type: "http", method: "POST", bodyType: "json", body: callBodySchema(stored.offer) },
    output: { schema: stored.offer.output },
    supportsCircleGateway: false,
    offerHash: stored.offerHash,
  };
  if (stored.offer.upstream) metadata.upstream = stored.offer.upstream;
  const accepts = acceptsFor(deps.rails, stored.offer, resource, now);
  metadata.supportsCircleGateway = accepts.some((entry) => entry.extra?.name === GATEWAY_BATCHED);

  return {
    resource,
    type: "http",
    x402Version: 2,
    lastUpdated: new Date(stored.offer.issuedAt * 1000).toISOString(),
    accepts,
    metadata,
  };
}

/**
 * Text match on title, summary or adapter. A query that contains an offer's hash, such as its
 * resource URL, matches that offer: `circle services inspect <url>` looks itself up that way.
 */
function matches(stored: StoredOffer, query: string): boolean {
  if (query === "") return true;
  if (query.includes(stored.offerHash.toLowerCase())) return true;
  const { offer } = stored;
  return [offer.title, offer.summary, offer.adapter].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function parseIntParam(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
