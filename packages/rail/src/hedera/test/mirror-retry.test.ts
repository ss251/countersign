import { describe, expect, test } from "bun:test";
import { getTransaction, mirrorFetch, MIRROR_RETRY_DELAYS_MS, MirrorError } from "../mirror.ts";
import { getSchedule } from "../schedule.ts";

const BASE = "http://mirror.test";

function fakeFetch(make: (call: number) => Response | Error): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  const fetch = (async () => {
    const answer = make(calls);
    calls++;
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

const status = (code: number) => () => new Response(null, { status: code });

describe("mirrorFetch retries a transient mirror failure", () => {
  test("502, 502, 200 returns the 200 after three calls", async () => {
    const f = fakeFetch((n) => (n < 2 ? new Response(null, { status: 502 }) : Response.json({ ok: true })));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(200);
    expect(f.calls()).toBe(3);
  });

  test("a thrown fetch then a 200 returns the 200 after two calls", async () => {
    const f = fakeFetch((n) => (n === 0 ? new Error("boom") : Response.json({ ok: true })));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(200);
    expect(f.calls()).toBe(2);
  });

  test("429 then 200 returns the 200 after two calls", async () => {
    const f = fakeFetch((n) => (n === 0 ? new Response(null, { status: 429 }) : Response.json({ ok: true })));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(200);
    expect(f.calls()).toBe(2);
  });

  test("404 is returned at once, unchanged", async () => {
    const f = fakeFetch(status(404));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(404);
    expect(f.calls()).toBe(1);
  });

  test("400 is returned at once, unchanged", async () => {
    const f = fakeFetch(status(400));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(400);
    expect(f.calls()).toBe(1);
  });

  test("503 every time returns the last 503 after four calls", async () => {
    const f = fakeFetch(status(503));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0, 0] });
    expect(r.status).toBe(503);
    expect(f.calls()).toBe(4);
  });

  test("503 with no retries returns the 503 after one call", async () => {
    const f = fakeFetch(status(503));
    const r = await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [] });
    expect(r.status).toBe(503);
    expect(f.calls()).toBe(1);
  });

  test("three throws with two retries rethrows the last error", async () => {
    const f = fakeFetch((n) => new Error(`boom ${n + 1}`));
    await expect(mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [0, 0] })).rejects.toThrow("boom 3");
    expect(f.calls()).toBe(3);
  });
});

describe("mirrorFetch delays", () => {
  test("the default delays are 500, 1000 and 2000 ms", () => {
    expect(MIRROR_RETRY_DELAYS_MS).toEqual([500, 1000, 2000]);
  });

  test("a 50 ms retry delay waits at least 45 ms", async () => {
    const f = fakeFetch((n) => (n === 0 ? new Response(null, { status: 502 }) : Response.json({ ok: true })));
    const started = Date.now();
    await mirrorFetch(`${BASE}/x`, { fetch: f.fetch, retryDelaysMs: [50] });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});

describe("the mirror reads ride out a blip", () => {
  test("getTransaction returns the record when the mirror answers 503 once", async () => {
    const record = {
      transaction_id: "0.0.9185802-1793957000-000000001",
      result: "SUCCESS",
      name: "CRYPTOTRANSFER",
      consensus_timestamp: "1793957000.000000001",
      memo_base64: null,
      transfers: [],
      token_transfers: [],
    };
    const f = fakeFetch((n) => (n === 0 ? new Response(null, { status: 503 }) : Response.json({ transactions: [record] })));

    const tx = await getTransaction("0.0.9185802@1793957000.000000001", {
      base: BASE,
      fetch: f.fetch,
      retryDelaysMs: [0],
    });

    expect(tx?.id).toBe(record.transaction_id);
    expect(tx?.result).toBe("SUCCESS");
    expect(f.calls()).toBe(2);
  });

  test("getSchedule returns the schedule when the mirror answers 502 once", async () => {
    const record = {
      schedule_id: "0.0.500",
      creator_account_id: "0.0.11337064",
      payer_account_id: "0.0.11337064",
      memo: "",
      executed_timestamp: null,
      expiration_time: "1793957300.000000000",
      deleted: false,
      wait_for_expiry: false,
      transaction_body: "",
      signatures: [],
    };
    const f = fakeFetch((n) => (n === 0 ? new Response(null, { status: 502 }) : Response.json(record)));

    const schedule = await getSchedule("0.0.500", { base: BASE, fetch: f.fetch, retryDelaysMs: [0] });

    expect(schedule?.id).toBe("0.0.500");
    expect(f.calls()).toBe(2);
  });

  test("getSchedule rejects with MirrorError 502 when the mirror never recovers", async () => {
    const f = fakeFetch(status(502));

    const error = await getSchedule("0.0.500", { base: BASE, fetch: f.fetch, retryDelaysMs: [0] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MirrorError);
    expect((error as MirrorError).status).toBe(502);
    expect(f.calls()).toBe(2);
  });
});
