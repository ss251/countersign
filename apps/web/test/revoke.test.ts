import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { envelopeRevokeMessage } from "@countersign/core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { recoverMessageAddress } from "viem";
import { approverAddress, makeApprover, signRevoke, SigningError } from "../src/lib/approver.ts";
import { api, type Resource } from "../src/lib/api.ts";
import type { EnvelopeView } from "../src/lib/types.ts";
import * as fx from "../src/fixtures/index.ts";
import { EnvelopeTab } from "../src/routes/buyer/EnvelopeTab.tsx";

// The phone's key and hub choices live in localStorage; here, a fresh in-memory one per test.
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage,
    location: { hash: "", search: "" },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  },
  configurable: true,
});

const realFetch = globalThis.fetch;
const HUB = "https://hub.example";
const TOKEN = "token-for-the-phone";
const AGENT = `0x${"ab".repeat(20)}`;
const NOW = 1_793_980_000;

interface Call {
  url: string;
  init: RequestInit | undefined;
}

let calls: Call[] = [];

function answer(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const mirror = (revocation: { revokedAt: number } | null) => ({
  envelope: structuredClone(fx.envelope.envelope),
  spent: structuredClone(fx.envelope.spent),
  signedAt: NOW,
  sig: `0x${"11".repeat(65)}`,
  verified: true,
  revocation,
});

beforeEach(() => {
  store.clear();
  calls = [];
  globalThis.fetch = realFetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  Reflect.deleteProperty(globalThis, "window");
});

describe("the phone revokes an envelope on the hub", () => {
  test("its approver key signs the revoke and the signature recovers to its address", async () => {
    const phone = await makeApprover();
    const { revokedAt, sig } = await signRevoke(AGENT, NOW);
    expect(revokedAt).toBe(NOW);
    const signer = await recoverMessageAddress({
      message: envelopeRevokeMessage(AGENT, NOW),
      signature: sig as `0x${string}`,
    });
    expect(signer.toLowerCase()).toBe(phone.toLowerCase());
    expect(approverAddress()?.toLowerCase()).toBe(phone.toLowerCase());
  });

  test("without a key, nothing is signed", async () => {
    const refused = await signRevoke(AGENT, NOW).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SigningError);
    expect((refused as SigningError).problem).toBe("no-key");
  });

  test("the call POSTs the signed revoke to the hub with the operator bearer", async () => {
    store.set("countersign.hub", HUB);
    store.set("countersign.approval-token", TOKEN);
    answer({ agent: AGENT, revoked: true, revokedAt: NOW });

    const result = await api.revokeEnvelope(AGENT, { revokedAt: NOW, sig: "0xsigned" });

    expect(result).toEqual({ ok: true, revokedAt: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${HUB}/envelopes/${AGENT}/revoke`);
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ revokedAt: NOW, sig: "0xsigned" });
  });

  test("a refused revoke gives the hub's own words back", async () => {
    store.set("countersign.hub", HUB);
    const message = "Refused. The revoke is not signed by this agent's approver.";
    answer({ message }, 401);

    expect(await api.revokeEnvelope(AGENT, { revokedAt: NOW, sig: "0xsigned" })).toEqual({ ok: false, message });
  });

  test("the envelope read takes the revoke from the mirror, not from local state", async () => {
    store.set("countersign.hub", HUB);
    store.set("countersign.agent", AGENT);

    answer(mirror({ revokedAt: 5 }));
    const revoked = await api.envelope();
    expect(revoked.source).toBe("hub");
    expect(revoked.data?.envelope.revoked).toBe(true);
    expect(revoked.data?.revokedAt).toBe(5);

    answer(mirror(null));
    const open = await api.envelope();
    expect(open.data?.envelope.revoked).toBe(false);
    expect(open.data?.revokedAt).toBeUndefined();
  });
});

describe("the envelope tab says which controls only change on the agent's machine", () => {
  const view = (revoked: boolean, revokedAt?: number): EnvelopeView => ({
    ...structuredClone(fx.envelope),
    agentName: "0xagent",
    envelope: { ...structuredClone(fx.envelope.envelope), revoked },
    revokedAt,
    mirror: { signedAt: NOW, agent: AGENT },
  });

  const resource = (data: EnvelopeView | null): Resource<EnvelopeView | null> => ({
    data,
    source: "hub",
    reason: undefined,
    needsToken: false,
    error: undefined,
    loading: false,
    reload: () => {},
    set: () => {},
  });

  const html = (data: EnvelopeView): string => renderToString(createElement(EnvelopeTab, { envelope: resource(data) }));

  test("an open hub view offers the revoke, and no local Save or reinstate", () => {
    const out = html(view(false));
    expect(out).toContain("Revoke the envelope");
    expect(out).toContain("env-revoke");
    expect(out).not.toContain("Save");
    expect(out).not.toContain("Issue a new envelope");
  });

  test("a revoked hub view says it stays revoked, and offers no reinstate", () => {
    const out = html(view(true, NOW));
    expect(out).toContain("env-revoked");
    expect(out).toContain("stays revoked");
    expect(out).not.toContain("Issue a new envelope");
  });
});
