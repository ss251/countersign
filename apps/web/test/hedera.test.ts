import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FOREIGN_HUB } from "../src/lib/hub.ts";
import { buyOnHedera, getHederaAccount, HederaError } from "../src/lib/hedera.ts";

const HUB = "https://hub.test";
const EVIL = "https://evil.example";
const TOKEN = "eyJ.privy-access-token.sig";
const OFFER = "0x119886bc5333f197f8bf62f469b6b3f37573c7de6c8ac8910be18a8d409dce4f";

type Sent = { url: string; init: RequestInit };

const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;
const realHub = process.env.VITE_HUB_URL;

beforeEach(() => {
  process.env.VITE_HUB_URL = HUB;
  pageAt("");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
  if (realHub === undefined) delete process.env.VITE_HUB_URL;
  else process.env.VITE_HUB_URL = realHub;
});

/** A console built for HUB, opened at `hash`, with the window state hub.ts reads. */
function pageAt(hash: string): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    location: { hash, search: "", origin: "https://web-production-a58de.up.railway.app" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    setTimeout,
    clearTimeout,
  };
}

/** Answers in order; the last answer repeats, so a retry test only needs one success. */
function answers(list: Array<{ status: number; body: unknown }>, sent?: Sent[]): void {
  let index = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent?.push({ url: String(input), init: init ?? {} });
    const next = list[Math.min(index, list.length - 1)]!;
    index += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function headersOf(sent: Sent): Record<string, string> {
  return (sent.init.headers ?? {}) as Record<string, string>;
}

describe("the Hedera account", () => {
  test("reads the signed-in person's account with the Privy token in the header only", async () => {
    const sent: Sent[] = [];
    answers([{ status: 200, body: { accountId: "0.0.9185802", usdc: "0.50" } }], sent);
    expect(await getHederaAccount(TOKEN)).toEqual({ accountId: "0.0.9185802", usdc: "0.50" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${HUB}/me/hedera`);
    const headers = headersOf(sent[0]!);
    expect(headers["x-privy-token"]).toBe(TOKEN);
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
    expect(sent[0]!.url).not.toContain(TOKEN);
  });

  test("a 404 means the feature is off, so there is no account", async () => {
    answers([{ status: 404, body: { code: "off", message: "not on this hub" } }]);
    expect(await getHederaAccount(TOKEN)).toBeNull();
  });

  test("a 409 while provisioning is retried, then the account arrives", async () => {
    const sent: Sent[] = [];
    answers(
      [
        { status: 409, body: { code: "provisioning" } },
        { status: 200, body: { accountId: "0.0.7", usdc: "1.00" } },
      ],
      sent,
    );
    expect(await getHederaAccount(TOKEN, { retryDelayMs: 0 })).toEqual({ accountId: "0.0.7", usdc: "1.00" });
    expect(sent).toHaveLength(2);
  });

  test("gives up after five retries and keeps the hub's answer", async () => {
    const sent: Sent[] = [];
    answers([{ status: 409, body: { code: "provisioning" } }], sent);
    const error = await getHederaAccount(TOKEN, { retryDelayMs: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HederaError);
    expect((error as HederaError).status).toBe(409);
    expect((error as HederaError).code).toBe("provisioning");
    expect(sent).toHaveLength(6);
  });

  test("any other refusal keeps the hub's message as is", async () => {
    answers([{ status: 502, body: { code: "unavailable", message: "The Hedera node is not answering." } }]);
    const error = await getHederaAccount(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HederaError);
    expect((error as HederaError).status).toBe(502);
    expect((error as HederaError).message).toBe("The Hedera node is not answering.");
    expect((error as HederaError).code).toBe("unavailable");
  });
});

describe("paying on Hedera", () => {
  const paid = {
    steps: [
      { label: "Payment signed by your Hedera wallet", at: "2026-11-07T10:00:00.000Z" },
      { label: "Seller delivered", at: "2026-11-07T10:00:02.000Z" },
      { label: "Output checked", at: "2026-11-07T10:00:02.500Z" },
      { label: "Settled on Hedera", at: "2026-11-07T10:00:05.000Z", url: "https://hashscan.io/testnet/transaction/0.0.1@1.2" },
      { label: "Slip minted", at: "2026-11-07T10:00:05.500Z", url: "/verify?slip=0xabc" },
    ],
    slipHash: "0xabc",
    hashscanUrl: "https://hashscan.io/testnet/transaction/0.0.1@1.2",
    output: { guidance: "Use the scheduled transfer." },
  };

  test("posts the offer and its input, and returns the hub's steps unchanged", async () => {
    const sent: Sent[] = [];
    answers([{ status: 200, body: paid }], sent);
    expect(await buyOnHedera(TOKEN, OFFER, { task: "transfer" })).toEqual(paid);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${HUB}/me/hedera/buy`);
    expect(sent[0]!.init.method).toBe("POST");
    expect(headersOf(sent[0]!)["x-privy-token"]).toBe(TOKEN);
    expect(Object.keys(headersOf(sent[0]!)).map((key) => key.toLowerCase())).not.toContain("authorization");
    expect(headersOf(sent[0]!)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ offerHash: OFFER, input: { task: "transfer" } });
  });

  test("a refusal shows the hub's message exactly", async () => {
    answers([{ status: 502, body: { code: "not-delivered", message: "Not delivered. Nothing was charged." } }]);
    const error = await buyOnHedera(TOKEN, OFFER, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HederaError);
    expect((error as HederaError).status).toBe(502);
    expect((error as HederaError).message).toBe("Not delivered. Nothing was charged.");
    expect((error as HederaError).code).toBe("not-delivered");
  });

  test("a refused spend names the price without naming the token", async () => {
    const message = "Refused. This would spend 0.50 USDC, but your account holds 0.10 USDC.";
    answers([{ status: 409, body: { code: "refused", message } }]);
    const error = await buyOnHedera(TOKEN, OFFER, {}).catch((e: unknown) => e);
    expect((error as HederaError).message).toBe(message);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});

describe("a hub a link chose", () => {
  test("the account read refuses before any request, so not one /me/hedera call reaches it", async () => {
    pageAt(`#/?hub=${encodeURIComponent(EVIL)}`);
    const sent: Sent[] = [];
    answers([{ status: 200, body: { accountId: "0.0.1", usdc: "1.00" } }], sent);
    const error = await getHederaAccount(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HederaError);
    expect((error as HederaError).status).toBe(403);
    expect((error as HederaError).code).toBe("foreign-hub");
    expect((error as HederaError).message).toBe(FOREIGN_HUB);
    expect(sent).toEqual([]);
  });

  test("a purchase sends nothing there, token or not: the guarded post refuses it", async () => {
    pageAt(`#/?hub=${encodeURIComponent(EVIL)}`);
    const sent: Sent[] = [];
    answers([{ status: 200, body: { steps: [], slipHash: "0xabc", hashscanUrl: "https://hashscan.io/testnet/tx/1" } }], sent);
    const error = await buyOnHedera(TOKEN, OFFER, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HederaError);
    expect((error as HederaError).status).toBe(403);
    expect((error as HederaError).code).toBe("foreign-hub");
    expect((error as HederaError).message).toBe(FOREIGN_HUB);
    expect(sent).toEqual([]);
  });
});
