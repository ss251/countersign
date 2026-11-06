import { createHash, timingSafeEqual } from "node:crypto";
import type { Hex } from "viem";
import {
  checkSchema,
  type CallResult,
  type Envelope,
  type JsonSchema,
  type Offer,
} from "@countersign/core";
import { buy } from "../buy.ts";
import type { HubClient, Listing } from "../hub-client.ts";
import type { Journal, JournalEntry } from "../journal.ts";
import { KNOWN_RAILS, type KnownRail } from "../known-rails.ts";
import type { SigningAccount } from "../mirror.ts";
import type { Payer } from "../payer.ts";
import type { State } from "../state.ts";

export interface OpenAIServerArgs {
  hub: HubClient;
  account: SigningAccount;
  envelope?: Envelope;
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

interface AnswerBody {
  status: number;
  body: string;
  contentType: string;
  headers: Record<string, string>;
  paymentSigned: boolean;
}

interface Answer extends AnswerBody {
  at: number;
}

const AUTH_MESSAGE = "Missing or wrong bearer token.";
const ANSWER_TTL_SECONDS = 60;
const COMPLETION_IDLE_SECONDS = 255;

const ENVELOPE_REASONS = new Set([
  "revoked",
  "expired",
  "not-allowlisted",
  "over-cap",
  "over-merchant-limit",
  "held",
  "no-approver",
  "approval-unavailable",
  "human-unverified",
  "human-declined",
  "human-expired",
  "human-timeout",
]);

export function startOpenAIServer(args: OpenAIServerArgs): OpenAIServerHandle {
  const { hub, account, envelope, journal, state, port, host = "127.0.0.1", token, now, payers } = args;
  const rails = args.known ?? [...KNOWN_RAILS, ...state.loadRails()];
  const clock = (): number => (typeof now === "function" ? now() : now);
  const answers = new Map<string, Answer>();
  const inflight = new Map<string, Promise<Answer>>();

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: COMPLETION_IDLE_SECONDS,
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
          server.timeout(req, 0);
          return await chatCompletion(req, {
            hub,
            account,
            envelope,
            journal,
            state,
            payers,
            rails,
            now: clock,
            answers,
            inflight,
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
  envelope?: Envelope;
  journal: Journal;
  state: State;
  payers: Payer[];
  rails: KnownRail[];
  now: () => number;
  answers: Map<string, Answer>;
  inflight: Map<string, Promise<Answer>>;
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
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return failure(400, "The body is not valid JSON.", "invalid_request_error", "bad_request");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
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

  const key = createHash("sha256").update(raw).digest("hex");
  const retry = isRetry(req.headers.get("x-stainless-retry-count"));
  const cached = deps.answers.get(key);
  if (cached !== undefined && replayable(cached, deps.now(), retry)) return respond(cached);
  const running = deps.inflight.get(key);
  if (running !== undefined) return respond(await running);

  const work = executeCompletion(body.model, text, body, deps).then((done) => ({
    at: deps.now(),
    ...done,
  }));
  deps.inflight.set(key, work);
  let answer: Answer;
  try {
    answer = await work;
  } finally {
    deps.inflight.delete(key);
  }
  if (answer.paymentSigned || answer.status === 200) deps.answers.set(key, answer);
  return respond(answer);
}

async function executeCompletion(
  model: string,
  text: string,
  body: JsonRecord,
  deps: ChatDeps,
): Promise<AnswerBody> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(model)) {
    return failureBody(404, "No such offer.", "invalid_request_error", "model_not_found");
  }
  const offerHash = model as Hex;
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
      return notFoundFromHub(e) ? failureBody(404, "No such offer.", "invalid_request_error", "model_not_found") : hubUnreachableBody();
    }
    if (listing.offerHash.toLowerCase() !== model.toLowerCase()) {
      return failureBody(404, "No such offer.", "invalid_request_error", "model_not_found");
    }
  }
  if (listing === undefined || listing.status !== "listed" || !listing.online) {
    return failureBody(404, "No such offer.", "invalid_request_error", "model_not_found");
  }

  const offer = listing.offer;
  const mapped = mapInput(offer, text);
  if (!mapped.ok) {
    return failureBody(
      400,
      `This offer needs JSON input with: ${requiredFields(offer.input)}`,
      "invalid_request_error",
      "bad_input",
    );
  }

  let envelope: Envelope;
  try {
    envelope = currentEnvelope(deps);
  } catch (e) {
    return failureBody(403, firstLine(e), "envelope_refused");
  }

  const at = deps.now();
  const before = deps.journal.entries().length;
  let result: CallResult;
  try {
    result = await buy({
      hub: deps.hub,
      offerHash,
      input: mapped.value,
      payers: deps.payers,
      envelope,
      journal: deps.journal,
      state: deps.state,
      now: at,
      account: deps.account,
      approvals: "local",
      known: deps.rails,
    });
  } catch (e) {
    return buyFailure(e, deps, before);
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
    return {
      status: 200,
      body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      paymentSigned: false,
    };
  }

  return {
    status: 200,
    body: JSON.stringify({
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
    }),
    contentType: "application/json",
    headers: {},
    paymentSigned: false,
  };
}

function currentEnvelope(deps: ChatDeps): Envelope {
  try {
    return deps.state.loadEnvelope();
  } catch (e) {
    if (deps.envelope !== undefined) return deps.envelope;
    throw e;
  }
}

function buyFailure(e: unknown, deps: ChatDeps, before: number): AnswerBody {
  const added = deps.journal.entries().slice(before);
  const signed = added.find(
    (entry): entry is JournalEntry & { jobId: string } =>
      (entry.kind === "signed" || entry.kind === "failed") && typeof entry.jobId === "string",
  );
  if (signed !== undefined) return paymentSignedBody(signed.jobId);
  if (added.some(envelopeRefused)) {
    return failureBody(403, firstLine(e), "envelope_refused");
  }
  return failureBody(402, firstLine(e), "payment_refused");
}

function envelopeRefused(entry: JournalEntry): boolean {
  return entry.kind === "refused" && entry.reason !== undefined && ENVELOPE_REASONS.has(entry.reason);
}

function paymentSignedBody(jobId: string): AnswerBody {
  return {
    status: 409,
    body: JSON.stringify({
      error: {
        type: "payment_signed",
        jobId,
        message: `The payment for job ${jobId} is signed, but its answer did not arrive. Do not send this completion again: run "cli.ts resume" to settle or refund the job.`,
      },
    }),
    contentType: "application/json",
    headers: { "x-should-retry": "false" },
    paymentSigned: true,
  };
}

function replayable(answer: Answer, now: number, retry: boolean): boolean {
  if (now - answer.at > ANSWER_TTL_SECONDS) return false;
  return answer.paymentSigned || retry;
}

function respond(answer: Answer | AnswerBody): Response {
  return new Response(answer.body, {
    status: answer.status,
    headers: { "content-type": answer.contentType, ...answer.headers },
  });
}

function failureBody(status: number, message: string, type: string, code?: string): AnswerBody {
  const error: { message: string; type: string; code?: string } = { message, type };
  if (code !== undefined) error.code = code;
  return {
    status,
    body: JSON.stringify({ error }),
    contentType: "application/json",
    headers: {},
    paymentSigned: false,
  };
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

function isRetry(header: string | null): boolean {
  if (header === null) return false;
  const count = Number(header);
  return Number.isInteger(count) && count > 0;
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

function hubUnreachableBody(): AnswerBody {
  return failureBody(502, "The hub could not be reached.", "server_error", "hub_unreachable");
}

function hubUnreachable(): Response {
  return respond(hubUnreachableBody());
}

function noSuchOffer(): Response {
  return failure(404, "No such offer.", "invalid_request_error", "model_not_found");
}

function failure(status: number, message: string, type: string, code?: string): Response {
  return respond(failureBody(status, message, type, code));
}

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
