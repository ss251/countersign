import { describe, expect, test } from "bun:test";
import { MIRROR_ATTEMPT_TIMEOUT_MS, mirrorFetch } from "../mirror.ts";

const BASE = "http://mirror.test";

function hangs(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return reject(new Error("attempt had no abort signal"));
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
  });
}

describe("every mirror attempt has a timeout", () => {
  test("the default is 5000 ms and every attempt receives an AbortSignal", async () => {
    expect(MIRROR_ATTEMPT_TIMEOUT_MS).toBe(5000);
    const signals: (AbortSignal | null | undefined)[] = [];
    let calls = 0;
    const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      calls++;
      return calls === 1 ? new Response(null, { status: 502 }) : Response.json({ ok: true });
    }) as unknown as typeof globalThis.fetch;

    const r = await mirrorFetch(`${BASE}/x`, { fetch, retryDelaysMs: [0] });

    expect(r.status).toBe(200);
    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("a timed-out attempt is retried", async () => {
    let calls = 0;
    const fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      calls++;
      return hangs(init?.signal);
    }) as unknown as typeof globalThis.fetch;

    const error = await mirrorFetch(`${BASE}/x`, { fetch, attemptTimeoutMs: 20, retryDelaysMs: [0] }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeDefined();
    expect(calls).toBe(2);
  });

  test("a hang on the first attempt is retried and the second answer is returned", async () => {
    let calls = 0;
    const fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls === 1) return hangs(init?.signal);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof globalThis.fetch;

    const r = await mirrorFetch(`${BASE}/x`, { fetch, attemptTimeoutMs: 20, retryDelaysMs: [0] });

    expect(r.status).toBe(200);
    expect(calls).toBe(2);
  });
});
