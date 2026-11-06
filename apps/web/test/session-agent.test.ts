import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "../src/lib/api.ts";
import { linkAgent, setSignedInAgent, signedInAgent } from "../src/lib/hub.ts";

/*
 * The Buyer phone reads the wallet a person signed in with, not the hub's latest buyer and not an
 * agent another link remembered. No browser and no network: window and fetch are mocked the way
 * w1-privy-token-origin.test.ts mocks them, and fetch answers the one question each test asks.
 */

const HUB = "https://hub.example";
const HUB_BUYER = `0x0656${"0".repeat(32)}abd8`;
const SIGNED_IN = `0x${"11".repeat(20)}`;
const LINKED = `0x${"22".repeat(20)}`;
const REMEMBERED = `0x${"33".repeat(20)}`;

type Sent = { url: string };

const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
  setSignedInAgent(null);
});

/** The page at `hash`, with a hub in localStorage and fetch recording every URL it is asked for. */
function pageAt(hash: string, remembered: Record<string, string> = {}, search = ""): Sent[] {
  const store = new Map<string, string>(Object.entries({ "countersign.hub": HUB, ...remembered }));
  (globalThis as { window?: unknown }).window = {
    location: { hash, search, origin: HUB },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    setTimeout,
    clearTimeout,
  };
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    sent.push({ url });
    if (url === `${HUB}/settlements?limit=1`) {
      return Response.json({ settlements: [{ buyer: HUB_BUYER }] });
    }
    return Response.json({
      envelope: { cap: "0", spent: {}, askBefore: "0", revoked: false },
      spent: { total: "0", sellers: [], offers: [] },
      signedAt: 1,
      sig: "0x",
      verified: true,
    });
  }) as typeof fetch;
  return sent;
}

const envelopeUrls = (sent: Sent[]) => sent.map((s) => s.url).filter((url) => url.includes("/envelopes/"));

describe("the agent the phone follows", () => {
  test("setSignedInAgent keeps a valid address, refuses a short one, and null clears it", () => {
    setSignedInAgent(SIGNED_IN);
    expect(signedInAgent()).toBe(SIGNED_IN);
    setSignedInAgent("0x123");
    expect(signedInAgent()).toBeNull();
    setSignedInAgent(SIGNED_IN);
    setSignedInAgent(null);
    expect(signedInAgent()).toBeNull();
  });

  test("linkAgent reads only this URL, never the remembered agent", () => {
    pageAt("#/buyer", { "countersign.agent": REMEMBERED });
    expect(linkAgent()).toBeNull();
    pageAt(`#/buyer?agent=${LINKED}`, { "countersign.agent": REMEMBERED });
    expect(linkAgent()).toBe(LINKED);
    pageAt("#/buyer", {}, `?agent=${LINKED}`);
    expect(linkAgent()).toBe(LINKED);
    pageAt(`#/buyer?agent=${LINKED}`, {}, `?agent=${REMEMBERED}`);
    expect(linkAgent()).toBe(LINKED);
  });

  test("a signed-in wallet asks the hub about that wallet, never the hub's latest buyer", async () => {
    const sent = pageAt("#/buyer", { "countersign.agent": REMEMBERED });
    setSignedInAgent(SIGNED_IN);
    await api.envelope();
    expect(envelopeUrls(sent)).toEqual([`${HUB}/envelopes/${SIGNED_IN}`]);
    expect(sent.map((s) => s.url)).not.toContain(`${HUB}/envelopes/${HUB_BUYER}`);
    expect(sent.map((s) => s.url)).not.toContain(`${HUB}/envelopes/${REMEMBERED}`);
    expect(sent.map((s) => s.url)).not.toContain(`${HUB}/settlements?limit=1`);
  });

  test("a ?agent= link still wins over the signed-in wallet", async () => {
    const sent = pageAt(`#/buyer?agent=${LINKED}`);
    setSignedInAgent(SIGNED_IN);
    await api.envelope();
    expect(envelopeUrls(sent)).toEqual([`${HUB}/envelopes/${LINKED}`]);
  });

  test("signed out with nothing remembered, the hub's latest buyer is read as before", async () => {
    const sent = pageAt("#/buyer");
    setSignedInAgent(null);
    await api.envelope();
    expect(envelopeUrls(sent)).toEqual([`${HUB}/envelopes/${HUB_BUYER}`]);
  });
});

const BUYER = new URL("../src/routes/buyer/", import.meta.url).pathname;
const buyerSources = readdirSync(BUYER)
  .filter((name) => /\.(ts|tsx)$/.test(name))
  .map((name) => ({ file: name, text: readFileSync(join(BUYER, name), "utf8") }));

describe("SignedInAgent is the only buyer file that follows the wallet into the session", () => {
  test("only SignedInAgent.tsx sets the signed-in agent", () => {
    const follow = buyerSources.filter((s) => s.text.includes("setSignedInAgent")).map((s) => s.file);
    expect(follow).toEqual(["SignedInAgent.tsx"]);
  });

  test("only SignedInAgent.tsx among those calls useWallets", () => {
    const follow = buyerSources.filter((s) => s.text.includes("setSignedInAgent") && /\buseWallets\s*\(/.test(s.text));
    expect(follow.map((s) => s.file)).toEqual(["SignedInAgent.tsx"]);
    // Approvals.tsx's token gate is the one pre-existing buyer caller; this packet adds no other.
    const callers = buyerSources
      .filter((s) => s.file !== "Approvals.tsx" && /\buseWallets\s*\(/.test(s.text))
      .map((s) => s.file);
    expect(callers).toEqual(["SignedInAgent.tsx"]);
  });
});
