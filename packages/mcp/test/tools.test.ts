import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HubClient } from "@countersign/buyer";
import type { Slip } from "@countersign/core";
import type { Hex } from "viem";
import { createCountersignMcpServer, type McpDeps } from "../src/index.ts";
import {
  ESCROW,
  OFFER_HASH,
  OTHER_HASH,
  PRICE,
  depsFor,
  hubState,
  makeVerifySlip,
  offer,
  spyAccount,
  stopHub,
  slips,
} from "./fixture.ts";

afterAll(() => stopHub());

async function withClient(deps: McpDeps, run: (client: Client) => Promise<void>): Promise<void> {
  const server = createCountersignMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "countersign-mcp-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close().catch(() => undefined);
  }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function bodyOf(result: CallToolResult): unknown {
  return JSON.parse(textOf(result)) as unknown;
}

function stubFetch(body: unknown, onRequest?: () => void): typeof fetch {
  return Object.assign(
    async () => {
      onRequest?.();
      return Response.json(body);
    },
    { preconnect: () => undefined },
  );
}

describe("the MCP tools", () => {
  test("listTools returns exactly the six tools", async () => {
    await withClient(depsFor(), async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "buy",
        "envelope_show",
        "get_offer",
        "journal",
        "search_offers",
        "verify_slip",
      ]);
    });
  });

  test("search_offers filters a two-offer listing by its query", async () => {
    await withClient(depsFor(), async (client) => {
      const result = await call(client, "search_offers", { query: "weather" });
      expect(result.isError).toBeUndefined();
      const items = bodyOf(result) as Array<{ offerHash: string; title: string; priceUsdc: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]?.offerHash).toBe(OTHER_HASH);
      expect(items[0]?.title).toBe("Weather");
      expect(items[0]?.priceUsdc).toBe("0.5");
    });
  });

  test("get_offer returns the whole offer and matches its hash case-insensitively", async () => {
    await withClient(depsFor(), async (client) => {
      const result = await call(client, "get_offer", { offerHash: OTHER_HASH.toUpperCase().replace("0X", "0x") });
      expect(result.isError).toBeUndefined();
      const value = bodyOf(result) as { offerHash: string; offer: { title: string } };
      expect(value.offerHash).toBe(OTHER_HASH.toUpperCase().replace("0X", "0x"));
      expect(value.offer.title).toBe("Weather");
    });
  });

  test("buy returns the output and the slip on the happy path", async () => {
    const deps = depsFor();
    await withClient(deps, async (client) => {
      const result = await call(client, "buy", { offerHash: OFFER_HASH, input: { q: "hi" } });
      expect(result.isError).toBeUndefined();
      const value = bodyOf(result) as {
        output: unknown;
        slipHash: Hex;
        releaseTx: string;
        explorer: string | null;
        slip: Slip;
      };
      expect(value.output).toEqual({ a: "hi" });
      expect(value.slipHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(value.slip.hash).toBe(value.slipHash);
      expect(value.slip.body.offerHash).toBe(OFFER_HASH);
      expect(value.slip.body.amount).toBe(PRICE);
      expect(value.slip.body.escrow).toBe(ESCROW);
      expect(value.releaseTx).toBe(`0x${"ab".repeat(32)}`);
      expect(value.explorer).toBeNull();
      expect(existsSync(deps.state.slipPath(value.slipHash))).toBe(true);
    });
  });

  test("buy refuses an envelope cap below the price without signing anything", async () => {
    const spy = spyAccount();
    const deps = depsFor({ account: spy.account, envelope: { cap: "100" } });
    await withClient(deps, async (client) => {
      const result = await call(client, "buy", { offerHash: OFFER_HASH, input: { q: "hi" } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Refused. This would spend 0.25 of a 0.0001 budget.");
      expect(spy.signatures()).toBe(0);
    });
  });

  test("buy without an account is a tool error naming CS_BUYER_KEY", async () => {
    await withClient(depsFor({ account: null }), async (client) => {
      const result = await call(client, "buy", { offerHash: OFFER_HASH, input: { q: "hi" } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Set CS_BUYER_KEY to the agent's private key.");
    });
  });

  test("buy refuses an unknown rail without signing anything", async () => {
    const spy = spyAccount();
    await withClient(depsFor({ account: spy.account }), async (client) => {
      const result = await call(client, "buy", {
        offerHash: OFFER_HASH,
        input: { q: "hi" },
        rail: "not-a-rail",
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Unknown rail not-a-rail.");
      expect(spy.signatures()).toBe(0);
    });
  });

  test("buy holds an amount above askAbove without signing anything", async () => {
    const paidBefore = hubState.paid;
    const spy = spyAccount();
    await withClient(depsFor({ account: spy.account, envelope: { askAbove: "100000" } }), async (client) => {
      const result = await call(client, "buy", { offerHash: OFFER_HASH, input: { q: "hi" } });
      expect(result.isError).toBe(true);
      expect(textOf(result).startsWith("Held.")).toBe(true);
      expect(spy.signatures()).toBe(0);
      expect(hubState.paid).toBe(paidBefore);
    });

    const extraSpy = spyAccount();
    await withClient(
      depsFor({ account: extraSpy.account, envelope: { askAbove: "100000" } }),
      async (client) => {
        const result = await call(client, "buy", {
          offerHash: OFFER_HASH,
          input: { q: "hi" },
          approve: true,
          approvals: "hub",
        });
        expect(result.isError).toBe(true);
        expect(textOf(result).startsWith("Held.")).toBe(true);
        expect(extraSpy.signatures()).toBe(0);
        expect(hubState.paid).toBe(paidBefore);
      },
    );
  });

  test("get_offer refuses a non-hash before asking the hub", async () => {
    let requests = 0;
    const hub = new HubClient(
      "http://hub.invalid",
      stubFetch({}, () => {
        requests += 1;
      }),
    );
    const deps = depsFor();
    deps.hub = hub;
    await withClient(deps, async (client) => {
      const result = await call(client, "get_offer", { offerHash: "../offers" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Refused. offerHash must be 0x followed by 64 hex characters.");
      expect(requests).toBe(0);
    });
  });

  test("search_offers keeps a listing whose price is not a number", async () => {
    const hub = new HubClient(
      "http://hub.invalid",
      stubFetch({
        offers: [
          { offerHash: OFFER_HASH, offer, online: true, status: "listed" },
          { offerHash: OTHER_HASH, offer: { ...offer, price: "not-a-number" }, online: true, status: "listed" },
        ],
      }),
    );
    const deps = depsFor();
    deps.hub = hub;
    await withClient(deps, async (client) => {
      const result = await call(client, "search_offers");
      expect(result.isError).toBeUndefined();
      const items = bodyOf(result) as Array<{ offerHash: string; priceUsdc: string | null }>;
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.offerHash === OFFER_HASH)?.priceUsdc).toBe("0.25");
      expect(items.find((item) => item.offerHash === OTHER_HASH)?.priceUsdc).toBeNull();
    });
  });

  test("verify_slip accepts one slip and rejects both or neither", async () => {
    const slip = await makeVerifySlip();
    await withClient(depsFor(), async (client) => {
      const valid = await call(client, "verify_slip", { slip });
      expect(valid.isError).toBeUndefined();
      const verdict = bodyOf(valid) as { valid: boolean; findings: Array<{ ok: boolean }> };
      expect(verdict.valid).toBe(true);
      expect(verdict.findings.every((finding) => finding.ok)).toBe(true);

      const both = await call(client, "verify_slip", { slip, slipHash: slip.hash });
      expect(both.isError).toBe(true);

      const neither = await call(client, "verify_slip");
      expect(neither.isError).toBe(true);
    });
  });

  test("verify_slip reads a hash from local state and from the hub", async () => {
    const slip = await makeVerifySlip();
    slips.set(slip.hash, slip);
    const deps = depsFor();
    deps.state.saveSlip(slip);
    await withClient(deps, async (client) => {
      const local = await call(client, "verify_slip", { slipHash: slip.hash });
      expect((bodyOf(local) as { valid: boolean }).valid).toBe(true);
    });

    await withClient(depsFor(), async (client) => {
      const remote = await call(client, "verify_slip", { slipHash: slip.hash });
      expect((bodyOf(remote) as { valid: boolean }).valid).toBe(true);
    });
  });

  test("verify_slip refuses a slipHash that escapes the slips directory", async () => {
    const deps = depsFor();
    writeFileSync(join(deps.state.dir, "outside.json"), JSON.stringify({ hash: "SENTINEL" }));
    await withClient(deps, async (client) => {
      const result = await call(client, "verify_slip", { slipHash: "../outside" });
      expect(result.isError).toBe(true);
      const message = textOf(result);
      expect(message).not.toContain("SENTINEL");
      expect(message).not.toContain("is not an object");
      expect(message).toBe("Refused. slipHash must be 0x followed by 64 hex characters.");
    });
  });

  test("envelope_show and journal answer from state", async () => {
    const deps = depsFor();
    deps.journal.append({
      at: 1,
      kind: "refused",
      offerHash: OFFER_HASH,
      seller: "0x0000000000000000000000000000000000000001",
      amount: "1",
    });
    await withClient(deps, async (client) => {
      const envelope = await call(client, "envelope_show");
      const shown = bodyOf(envelope) as { envelope: { cap: string }; spent: { total: string } };
      expect(shown.envelope.cap).toBe("5000000");
      expect(shown.spent.total).toBe("0");

      const journal = await call(client, "journal", { limit: 1 });
      const entries = bodyOf(journal) as Array<{ kind: string }>;
      expect(entries.map((entry) => entry.kind)).toEqual(["refused"]);
    });
  });
});
