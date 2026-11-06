import { createHash, timingSafeEqual } from "node:crypto";
import {
  checkSchema,
  type CallResult,
  type Envelope,
  type JsonSchema,
  type Offer,
} from "@countersign/core";
import { BuyError, buy } from "../buy.ts";
import type { HubClient, Listing } from "../hub-client.ts";
import type { Journal } from "../journal.ts";
import { KNOWN_RAILS, type KnownRail } from "../known-rails.ts";
import type { SigningAccount } from "../mirror.ts";
import type { Payer } from "../payer.ts";
import type { State } from "../state.ts";

export interface OpenAIServerArgs {
  hub: HubClient;
  account: SigningAccount;
  envelope: Envelope;
  journal: Journal;
  state: State;
  port: number;
  host?: string;
  token: string;
  now: number | (() => number);
  payers: Payer[];
  /** Extra rails this buyer trusts besides the built-in table. */
  known?: KnownRail[];
}

export interface OpenAIServerHandle {
  url: string;
  stop: () => Promise<void>;
}

type JsonRecord = Record<string, unknown>;

interface ChatMessage {
  role: string;
  content: unknown;
}

interface MappedInput {
  ok: true;
  value: unknown;
}

interface UnmappedInput {
  ok: false;
}

const AUTH_MESSAGE = "Missing or wrong bearer token.";

export function startOpenAIServer(args: OpenAIServerArgs): OpenAIServerHandle {
  const { hub, account, envelope, journal, state, port, host = "127.0.0.1", token, now, payers } = args;
  const rails = args.known ?? [...KNOWN_RAILS, ...state.loadRails()];
  const clock = (): number => (typeof now === "function" ? now() : now);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      if (!authorized(req.headers.get("authorization"), token)) {
        return failure(401, AUTH_MESSAGE, "invalid_request_error", "unauthorized");
      }

      try {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/models") {
          return await listModels(hub);
        }
        if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
          return await chatCompletion(req, {
            hub,
            account,
            envelope,
            journal,
            state,
            payers,
            rails,
            now: clock,
          });
        }
        return failure(404, "Not found.", "invalid_request_error", "not_found");
      } catch (e) {
        return failure(500, firstLine(e), "server_error", "internal_error");
      }
    },
  });

  return {
    url: `http://${host}:${server.port}`,
    stop: () => server.stop(true),
  };
}

interface ChatDeps {
  hub: HubClient;
  account: SigningAccount;
  envelope: Envelope;
  journal: Journal;
  state: State;
  payers: Payer[];
  rails: KnownRail[];
  now: () => number;
}

async function listModels(hub: HubClient): Promise<Response> {
  let listings: Listing[];
  try {
    listings = await hub.listOffers();
  } catch {
    return hubUnreachable();
  }
  const data = listings
    .filter((listing) => listing.status === "listed" && listing.online)
    .map((listing) => ({
      id: listing.offerHash,
      object: "model",
      created: listing.offer.issuedAt,
      owned_by: listing.offer.seller,
    }));
  return ok({ object: "list", data });
}

async function chatCompletion(req: Request, deps: ChatDeps): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failure(400, "The body is not valid JSON.", "invalid_request_error", "bad_request");
  }
  if (!isRecord(body)) {
    return failure(400, "The body must be a JSON object.", "invalid_request_error", "bad_request");
  }
  if (typeof body.model !== "string") {
    return noSuchOffer();
  }
  const messages = readMessages(body.messages);
  if (messages === undefined) {
    return failure(400, "messages must be an array of chat messages.", "invalid_request_error", "bad_request");
  }
  const text = lastUserText(messages);
  if (text === undefined) {
    return failure(400, "The request has no user message.", "invalid_request_error", "bad_input");
  }

  const model = body.model;
  let listing: Listing | undefined;
  try {
    const listings = await deps.hub.listOffers();
    listing = listings.find(
      (candidate) =>
        candidate.offerHash.toLowerCase() === model.toLowerCase() &&
        candidate.status === "listed" &&
        candidate.online,
    );
  } catch {
    // A minimal hub may expose the single-offer route but not the list.
    try {
      listing = await deps.hub.getOffer(model);
    } catch (e) {
      return notFoundFromHub(e) ? noSuchOffer() : hubUnreachable();
    }
  }
  if (listing === undefined || listing.status !== "listed" || !listing.online) {
    return noSuchOffer();
  }

  const offer = listing.offer;
  const mapped = mapInput(offer, text);
  if (!mapped.ok) {
    return failure(
      400,
      `This offer needs JSON input with: ${requiredFields(offer.input)}`,
      "invalid_request_error",
      "bad_input",
    );
  }

  const at = deps.now();
  let result: CallResult;
  try {
    result = await buy({
      hub: deps.hub,
      offerHash: listing.offerHash,
      input: mapped.value,
      payers: deps.payers,
      envelope: deps.envelope,
      journal: deps.journal,
      state: deps.state,
      now: at,
      account: deps.account,
      approvals: "local",
      known: deps.rails,
    });
  } catch (e) {
    return buyFailure(e);
  }

  const slip = result.slip;
  const content = JSON.stringify(result.output);
  const id = `chatcmpl-${slip.hash.slice(2, 26)}`;
  const countersign = {
    slipHash: slip.hash,
    tx: slip.settlement.transaction,
    explorer: slip.settlement.url ?? null,
    amount: slip.body.amount,
    rail: slip.body.rail,
  };

  if (body.stream === true) {
    const chunk = {
      id,
      object: "chat.completion.chunk",
      created: at,
      model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  return ok({
    id,
    object: "chat.completion",
    created: at,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    countersign,
  });
}

function buyFailure(e: unknown): Response {
  if (e instanceof BuyError) {
    if (isEnvelopeRefusal(e.message)) {
      return failure(403, e.message, "envelope_refused");
    }
    return failure(402, e.message, "payment_refused");
  }
  return failure(500, firstLine(e), "server_error", "internal_error");
}

function isEnvelopeRefusal(message: string): boolean {
  if (message.startsWith("Held")) return true;
  if (!message.startsWith("Refused.")) return false;
  const lower = message.toLowerCase();
  return ["budget", "limit", "allowlist", "revoked", "expired"].some((word) => lower.includes(word));
}

function mapInput(offer: Offer, text: string): MappedInput | UnmappedInput {
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = true;
  } catch {
    isJson = false;
  }
  if (isJson && checkSchema(offer.input, parsed).ok) {
    return { ok: true, value: parsed };
  }
  const only = singleStringRequired(offer.input);
  if (only !== undefined) {
    return { ok: true, value: { [only]: text } };
  }
  return { ok: false };
}

function singleStringRequired(schema: JsonSchema): string | undefined {
  const required: unknown = schema.required;
  if (!Array.isArray(required) || required.length !== 1) return undefined;
  const name: unknown = required[0];
  if (typeof name !== "string") return undefined;
  const properties: unknown = schema.properties;
  if (!isRecord(properties)) return undefined;
  const property: unknown = properties[name];
  if (!isRecord(property) || property.type !== "string") return undefined;
  return name;
}

function requiredFields(schema: JsonSchema): string {
  const required: unknown = schema.required;
  if (!Array.isArray(required) || required.length === 0) return "an object";
  const names = required.filter((value): value is string => typeof value === "string");
  return names.length === 0 ? "an object" : names.join(", ");
}

function lastUserText(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return textContent(message.content);
  }
  return undefined;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

function readMessages(value: unknown): ChatMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.role !== "string") return undefined;
    messages.push({ role: item.role, content: item.content });
  }
  return messages;
}

function authorized(header: string | null, token: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  return timingSafeEqual(digest(presented), digest(token));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const line = message.split("\n")[0]?.trim();
  return line ? line : "Internal error.";
}

function notFoundFromHub(e: unknown): boolean {
  return e instanceof Error && e.message.includes("404");
}

function hubUnreachable(): Response {
  return failure(502, "The hub could not be reached.", "server_error", "hub_unreachable");
}

function noSuchOffer(): Response {
  return failure(404, "No such offer.", "invalid_request_error", "model_not_found");
}

function failure(status: number, message: string, type: string, code?: string): Response {
  const error: { message: string; type: string; code?: string } = { message, type };
  if (code !== undefined) error.code = code;
  return ok({ error }, status);
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
