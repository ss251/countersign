import { afterEach, describe, expect, mock, test } from "bun:test";

// cs-w1 adversarial test (cs-audit 01:14:58Z (b); for cs-ui's approval-token binding PR). A failing test here is a blocker.
// The console takes its hub from a ?hub= link parameter and keeps it (lib/hub.ts hubBase). The Buyer's envelope,
// approvals and purchases reads send the approval token as "authorization: Bearer" (api.ts tokenHeader), and so does
// decide(). A link to the real console that names another hub would hand that host the person's approval token.
// Invariant: the approval token goes only to the hub it was saved for (a token saved before binding: the build's own hub),
// never to a hub a link chose, and never to a lookalike of the own hub.

const OWN = "https://hub.example";
const EVIL = "https://evil.example";
const AGENT = "0x1234567890abcdef1234567890abcdef12345678";
const TOKEN = "cse_victim_approval_token";
const TOKEN_KEY = "countersign.approval-token";

process.env.VITE_HUB_URL = OWN;

// decide() signs on the device first; the signature is not what this test is about.
const realApprover = await import("../src/lib/approver.ts");
mock.module("../src/lib/approver.ts", () => ({
  ...realApprover,
  signDecision: async () => ({ decidedAt: 1_800_000_000, sig: `0x${"11".repeat(65)}` }),
}));
const { api } = await import("../src/lib/api.ts");
const { rememberApprovalToken } = await import("../src/lib/hub.ts");

type Sent = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
});

/** One browser profile: localStorage survives from one page to the next, as it does for a person. */
function profile(): { open: (hash: string) => void; store: Map<string, string>; sent: Sent[] } {
  const store = new Map<string, string>();
  const sent: Sent[] = [];
  const location = { hash: "", search: "", origin: "https://web-production-a58de.up.railway.app" };
  (globalThis as { window?: unknown }).window = {
    location,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    setTimeout,
    clearTimeout,
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const flat: Record<string, string> = {};
    headers.forEach((value, key) => {
      flat[key] = value;
    });
    sent.push({ url: String(input), headers: flat });
    const url = String(input);
    const body = url.includes("/approvals") ? { approvals: [] } : url.includes("/jobs") ? { jobs: [] } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { open: (hash) => void (location.hash = hash), store, sent };
}

function leakedTo(sent: Sent[], base: string): Sent[] {
  return sent.filter((r) => r.url.startsWith(base) && r.headers.authorization !== undefined);
}

async function buyerReads(): Promise<void> {
  await api.envelope().catch(() => undefined);
  await api.approvals().catch(() => undefined);
  await api.purchases().catch(() => undefined);
}

async function decideOnce(): Promise<void> {
  const approval = { id: "ap_w1", agent: AGENT } as unknown as Parameters<typeof api.decide>[0];
  await api.decide(approval, "decline").catch(() => undefined);
}

describe("W1: the approval token never goes to a hub a link chose", () => {
  test("a token kept from before the binding is not sent to ?hub=<other>, on reads or on decide()", async () => {
    const p = profile();
    p.store.set(TOKEN_KEY, TOKEN);
    p.open(`#/buyer?hub=${encodeURIComponent(EVIL)}&agent=${AGENT}`);
    await buyerReads();
    await decideOnce();
    expect(leakedTo(p.sent, EVIL)).toEqual([]);
  });

  test("a token saved on the own hub is not sent after a link switches the hub, on reads or on decide()", async () => {
    const p = profile();
    p.open(`#/buyer?agent=${AGENT}`);
    rememberApprovalToken(TOKEN);
    p.open(`#/buyer?hub=${encodeURIComponent(EVIL)}&agent=${AGENT}`);
    await buyerReads();
    await decideOnce();
    expect(leakedTo(p.sent, EVIL)).toEqual([]);
  });

  test("lookalikes of the own hub get nothing", async () => {
    for (const lookalike of [`${OWN}.evil.example`, `${OWN}@evil.example`, `${OWN}:8443`, `http://hub.example`]) {
      const p = profile();
      p.open(`#/buyer?agent=${AGENT}`);
      rememberApprovalToken(TOKEN);
      p.open(`#/buyer?hub=${encodeURIComponent(lookalike)}&agent=${AGENT}`);
      await buyerReads();
      await decideOnce();
      expect({ lookalike, leaked: leakedTo(p.sent, lookalike) }).toEqual({ lookalike, leaked: [] });
    }
  });

  test("a token saved on ?hub=local is not sent when a link later names another hub", async () => {
    const p = profile();
    p.open(`#/buyer?hub=local&agent=${AGENT}`);
    rememberApprovalToken(TOKEN);
    p.open(`#/buyer?hub=${encodeURIComponent(EVIL)}&agent=${AGENT}`);
    await buyerReads();
    expect(leakedTo(p.sent, EVIL)).toEqual([]);
  });

  test("control: the own hub still gets the token it was saved for", async () => {
    const p = profile();
    p.open(`#/buyer?agent=${AGENT}`);
    rememberApprovalToken(TOKEN);
    await buyerReads();
    const own = p.sent.filter((r) => r.url.startsWith(OWN));
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((r) => r.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });
});
