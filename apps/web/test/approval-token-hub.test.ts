import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { api } from "../src/lib/api.ts";
import { HubError, approvalToken, rememberApprovalToken } from "../src/lib/hub.ts";

/**
 * cs-audit 01:14:58Z: a link that persists ?hub=<other> must not carry this hub's approval token there. The
 * token goes only to the hub it was saved on; one saved before that was recorded belongs to the build's hub.
 */
const OWN = "https://hub-production-e85e.up.railway.app";
const EVIL = "https://evil.example";
const LOCAL = "http://localhost:8787";
const AGENT = "0x1234567890abcdef1234567890abcdef12345678";
const TOKEN = "cst_saved_on_the_real_hub";
const TOKEN_KEY = "countersign.approval-token";
const TOKEN_HUB_KEY = "countersign.approval-token-hub";

type Sent = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;
const realHub = process.env.VITE_HUB_URL;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
  if (realHub === undefined) delete process.env.VITE_HUB_URL;
  else process.env.VITE_HUB_URL = realHub;
});

/** One browser built for OWN: its storage lasts across the pages it opens, and fetch is captured. */
function device() {
  process.env.VITE_HUB_URL = OWN;
  const store = new Map<string, string>();
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    return new Response(JSON.stringify({ envelope: { cap: "1000000", perMerchant: "100000" }, spent: "0", signedAt: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const open = (hash: string) => {
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
  };
  return { store, sent, open };
}

const page = (hub?: string) => `#/buyer?${hub === undefined ? "" : `hub=${encodeURIComponent(hub)}&`}agent=${AGENT}`;
const anApproval = { id: "appr_1" } as unknown as Parameters<typeof api.decide>[0];

describe("the approval token goes only to the hub it was saved on (cs-audit 01:14:58Z)", () => {
  test("saved on this console's own hub, it goes to that hub with a read", async () => {
    const { store, sent, open } = device();
    open(page());
    rememberApprovalToken(TOKEN);
    expect(store.get(TOKEN_HUB_KEY)).toBe(OWN);
    expect(approvalToken()).toBe(TOKEN);

    await api.envelope();
    const read = sent.find((s) => s.url.includes(`/envelopes/${AGENT}`));
    expect(read?.url.startsWith(OWN)).toBe(true);
    expect(read?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("a link that chose another hub never gets it: the read goes there without it, and a decision sends nothing", async () => {
    const { sent, open } = device();
    open(page());
    rememberApprovalToken(TOKEN);

    open(page(EVIL));
    expect(approvalToken()).toBeNull();
    sent.length = 0;
    await api.envelope();
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s.url.startsWith(EVIL)).toBe(true);
      expect(Object.keys(s.headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    }

    // The link persists the hub, so the next page without ?hub= is still the other hub.
    open(page());
    expect(approvalToken()).toBeNull();

    sent.length = 0;
    const failure = await api.decide(anApproval, "countersign").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HubError);
    if (!(failure instanceof HubError)) throw new Error("expected a HubError");
    expect(failure.status).toBe(401);
    expect(failure.code).toBe("no-token");
    expect(sent).toEqual([]);
  });

  test("back on the own hub (?hub=default), the token is handed out again", () => {
    const { open } = device();
    open(page());
    rememberApprovalToken(TOKEN);
    open(page(EVIL));
    expect(approvalToken()).toBeNull();
    open(page("default"));
    expect(approvalToken()).toBe(TOKEN);
  });

  test("a token saved before the hub was recorded belongs to the build's own hub", () => {
    const { store, open } = device();
    store.set(TOKEN_KEY, TOKEN);
    open(page());
    expect(approvalToken()).toBe(TOKEN);
    open(page(EVIL));
    expect(approvalToken()).toBeNull();
  });

  test("a token pasted for another hub goes to that hub only, never to this console's own", () => {
    const { store, open } = device();
    open(page(LOCAL));
    rememberApprovalToken("cst_for_the_local_hub");
    expect(store.get(TOKEN_HUB_KEY)).toBe(LOCAL);
    expect(approvalToken()).toBe("cst_for_the_local_hub");
    open(page("default"));
    expect(approvalToken()).toBeNull();
  });

  test("forgetting the token clears it and its hub", () => {
    const { store, open } = device();
    open(page());
    rememberApprovalToken(TOKEN);
    rememberApprovalToken(null);
    expect(store.has(TOKEN_KEY)).toBe(false);
    expect(store.has(TOKEN_HUB_KEY)).toBe(false);
    expect(approvalToken()).toBeNull();
  });

  test("the console builds an approval Bearer header only from approvalToken()", () => {
    const src = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
    expect(src.match(/Bearer \$\{token\}/g)?.length).toBe(2);
    expect(src.match(/const token = approvalToken\(\);/g)?.length).toBe(2);
    expect(src).not.toMatch(/localStorage\.getItem\(["']countersign\.approval-token["']\)/);
  });
});
