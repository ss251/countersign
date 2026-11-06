import { afterEach, describe, expect, test } from "bun:test";
import { hubPost } from "../src/lib/hub.ts";
import { createSessionEnvelope } from "../src/routes/buyer/session.ts";

// cs-w1 adversarial test (B30; runs on cs/ui-C2, PR #275, STEER-0215 C2). A failing test here is a blocker.
// The console takes its hub from a ?hub= link parameter and keeps it (lib/hub.ts hubBase). "Create an envelope"
// then posts the person's Privy access token to that hub. A link to the real console that names another hub
// would hand the person's Privy session to whoever runs it, and with it they can mint the person's cse_ token
// at the real hub (POST /envelopes/session) and read their envelope and approvals.
// Invariant: the Privy access token goes only to the hub this console was built for, never to a hub a link chose.

const EVIL = "https://evil.example";
const AGENT = "0x1234567890abcdef1234567890abcdef12345678";

type Sent = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
});

function pageAt(hash: string): Sent[] {
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
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    return new Response(JSON.stringify({ agent: AGENT, token: "cse_attacker_issued", envelope: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}

describe("W1 B30: the Privy access token never goes to a hub a link chose", () => {
  test("Create an envelope on a console opened with ?hub=<other> sends no Privy token there", async () => {
    const sent = pageAt(`#/buyer?hub=${encodeURIComponent(EVIL)}`);
    await createSessionEnvelope({
      post: (path, body, headers) => hubPost(path, body, headers),
      privyToken: "eyJ.victim-privy-access-token.sig",
      agent: AGENT,
      rememberToken: () => undefined,
      rememberAgent: () => undefined,
    }).catch(() => undefined);
    const leaked = sent.filter(
      (request) => request.url.startsWith(EVIL) && Object.keys(request.headers).some((h) => h.toLowerCase() === "x-privy-token"),
    );
    expect(leaked).toEqual([]);
  });
});
