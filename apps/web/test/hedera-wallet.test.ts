import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadHederaAccount, ownHubHederaAccount } from "../src/ui/WalletButton.tsx";

const HUB = "https://hub.test";
const EVIL = "https://evil.example";
const TOKEN = "eyJ.privy-access-token.sig";

type Sent = { url: string; headers: Record<string, string> };

const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;
const realHub = process.env.VITE_HUB_URL;

/** A console built for HUB, opened at `hash`, with fetch captured the way the hub tests do. */
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
    return new Response(JSON.stringify({ accountId: "0.0.9185802", usdc: "0.50" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}

beforeEach(() => {
  process.env.VITE_HUB_URL = HUB;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
  if (realHub === undefined) delete process.env.VITE_HUB_URL;
  else process.env.VITE_HUB_URL = realHub;
});

describe("the wallet menu's page-load Hedera read", () => {
  test("on this console's own hub it sends the Privy token once and gets the account", async () => {
    const sent = pageAt("");
    expect(await loadHederaAccount(async () => TOKEN)).toEqual({ accountId: "0.0.9185802", usdc: "0.50" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`${HUB}/me/hedera`);
    expect(sent[0]!.headers["x-privy-token"]).toBe(TOKEN);
  });

  test("a signed-in page at ?hub=<evil> makes no request at all, and asks for no token", async () => {
    const sent = pageAt(`#/?hub=${encodeURIComponent(EVIL)}`);
    let asked = 0;
    const found = await loadHederaAccount(async () => {
      asked += 1;
      return TOKEN;
    });
    expect(found).toBeNull();
    expect(asked).toBe(0);
    expect(sent).toEqual([]);
    const leaked = sent.filter(
      (request) =>
        request.url.startsWith(EVIL) || Object.keys(request.headers).some((h) => h.toLowerCase() === "x-privy-token"),
    );
    expect(leaked).toEqual([]);
  });
});

describe("the wallet menu's Hedera line", () => {
  const account = { accountId: "0.0.9185802", usdc: "0.50" };

  test("on a hub a link chose it shows nothing, even if an account was read before", () => {
    pageAt(`#/?hub=${encodeURIComponent(EVIL)}`);
    expect(ownHubHederaAccount(account)).toBeNull();
  });

  test("on this console's own hub it shows the account it was given", () => {
    pageAt("");
    expect(ownHubHederaAccount(account)).toEqual(account);
  });
});
