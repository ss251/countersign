import { afterEach, describe, expect, test } from "bun:test";

// cs-w1 adversarial test (B35; runs on cs/hd-34b c8b5de9, PR #352, STEER-0715). A failing test here is a blocker.
// The console takes its hub from a ?hub= link parameter and keeps it (lib/hub.ts hubBase). #275 (B30) made the
// guarded hubGet/hubPost refuse to send the Privy access token (x-privy-token) to any hub but the build's own.
// lib/hedera.ts sends x-privy-token with a raw fetch to whatever hub its caller passes, and both callers pass
// hubBase(): the Sign in menu (WalletButton useHederaAccount) on every page load for a signed-in person, and the
// Assistant's HederaPay (account read and the buy). So a link to the real console that names another hub hands
// that host the person's Privy session, with no click. With it, the host can call the real hub as the person:
// POST /me/hedera/buy (pay from their Hedera account), POST /envelopes/session, or approve a CLI device login.
// Invariant: the Privy access token goes only to the hub this console was built for, on these paths too.

const OWN = "https://hub.example";
const EVIL = "https://evil.example";
const PRIVY = "eyJ.victim-privy-access-token.sig";
const OFFER = "0x119886bc5333f197f8bf62f469b6b3f37573c7de6c8ac8910be18a8d409dce4f";

process.env.VITE_HUB_URL = OWN;

const { getHederaAccount, buyOnHedera } = await import("../src/lib/hedera.ts");
const { hubBase } = await import("../src/lib/hub.ts");

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
    dispatchEvent: () => true,
  };
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const flat: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((value, key) => {
      flat[key] = value;
    });
    sent.push({ url: String(input), headers: flat });
    const url = String(input);
    const body = url.endsWith("/me/hedera")
      ? { accountId: "0.0.6666666", usdc: "0.50" }
      : { steps: [], slipHash: "0x", hashscanUrl: "https://hashscan.io/testnet", output: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return sent;
}

function privyTo(sent: Sent[], base: string): Sent[] {
  return sent.filter((r) => r.url.startsWith(base) && r.headers["x-privy-token"] !== undefined);
}

/** What the Sign in menu (WalletButton useHederaAccount) and the Assistant's HederaPay do, with the hub they pass. */
async function asTheConsoleDoes(): Promise<void> {
  const hub = hubBase();
  if (!hub) return;
  await getHederaAccount(hub, PRIVY, { retryDelayMs: 0 }).catch(() => undefined);
  await buyOnHedera(hub, PRIVY, OFFER, { q: "hi" }).catch(() => undefined);
}

describe("W1 B35: the Privy access token never goes to a hub a link chose, on the Hedera paths", () => {
  test("a console opened with ?hub=<other> sends no Privy token there, on the account read or the buy", async () => {
    const sent = pageAt(`#/assistant?hub=${encodeURIComponent(EVIL)}`);
    await asTheConsoleDoes();
    expect(privyTo(sent, EVIL)).toEqual([]);
  });

  test("a lookalike of the own hub gets no Privy token either", async () => {
    const lookalike = `${OWN}.evil.example`;
    const sent = pageAt(`#/assistant?hub=${encodeURIComponent(lookalike)}`);
    await asTheConsoleDoes();
    expect(privyTo(sent, lookalike)).toEqual([]);
  });

  test("control: the console's own hub still gets the Privy token on both calls", async () => {
    const sent = pageAt("#/assistant");
    await asTheConsoleDoes();
    const own = privyTo(sent, OWN).map((r) => new URL(r.url).pathname);
    expect(own).toEqual(["/me/hedera", "/me/hedera/buy"]);
  });
});
