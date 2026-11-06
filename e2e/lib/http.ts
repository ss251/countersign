/**
 * Plain HTTP for the suite, as a clean client: no cookies, no stored state, a generic agent.
 * Every exchange is written to the flow's artifacts, redacted, numbered in order.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Exchange {
  status: number;
  headers: Headers;
  text: string;
  /** Parsed body, or undefined when the body is not JSON. */
  json: unknown;
}

export interface HttpRecorder {
  (label: string, url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Exchange>;
}

const AGENT = "countersign-e2e";

export function httpRecorder(dir: string, redact: (s: string) => string): HttpRecorder {
  let n = 0;
  return async (label, url, init = {}) => {
    n += 1;
    const file = join(dir, `http-${String(n).padStart(2, "0")}-${slug(label)}.json`);
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", AGENT);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    const method = init.method ?? "GET";
    const record: Record<string, unknown> = {
      label,
      request: { method, url, headers: plainHeaders(headers), body: bodyText(init.body) },
    };
    try {
      const res = await fetch(url, {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      record.response = { status: res.status, headers: plainHeaders(res.headers), body: json ?? text };
      return { status: res.status, headers: res.headers, text, json };
    } catch (e) {
      record.error = (e as Error).message;
      throw new Error(`${method} ${url} failed: ${(e as Error).message}`);
    } finally {
      writeFileSync(file, redact(JSON.stringify(record, null, 2)));
    }
  };
}

function plainHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key] = key === "authorization" ? "[redacted]" : value;
  });
  return out;
}

function bodyText(body: RequestInit["body"]): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") return "(binary)";
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "call";
}

/** A free TCP port on 127.0.0.1. */
export function freePort(): number {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("no free port");
  return port;
}

/** True when nothing answers on the port. */
export async function portClosed(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return false;
  } catch {
    return true;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Failures where the server never answered: the request may not even have reached it. */
export const TRANSPORT_ERROR =
  /socket connection was closed|ECONNRESET|ECONNREFUSED|ConnectionClosed|ConnectionRefused|fetch failed|Unable to connect|operation timed out/i;

/**
 * Run a read that moves nothing against a third-party API (Circle's Gateway, the Hedera mirror),
 * repeating it while it fails before the server answers, up to `attempts` times. An answer of any
 * kind, an error included, is returned or thrown at once. Calls to the hub under test never come
 * through here.
 */
export async function readWithRetry<T>(read: () => Promise<T>, onRetry?: (why: string) => void, attempts = 3): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await read();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (n >= attempts || !TRANSPORT_ERROR.test(why)) throw e;
      onRetry?.(why.split("\n")[0]!.slice(0, 160));
      await sleep(500 * n);
    }
  }
}

/**
 * The status a logged-out client gets for a public link, without following redirects: a link
 * a judge clicks must answer 200 itself. Retried, because explorers stall now and then.
 */
export async function linkStatus(url: string, attempts = 3): Promise<number> {
  let last = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "countersign-e2e" } });
      last = res.status;
      await res.body?.cancel();
      if (last === 200) return last;
    } catch {
      last = -1;
    }
    await sleep(2000 * (i + 1));
  }
  return last;
}
