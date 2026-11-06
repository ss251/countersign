/**
 * Offline tests of the npm-published flow's parsing helpers. No npm install, no hub, no chain.
 */

import { describe, expect, test } from "bun:test";
import { mcpVerdict, parseMcpBuy, useArcDiscoverLine } from "../flows/npm-published.flow.ts";

const OFFER_HASH = `0x${"a1".repeat(32)}`;
const OTHER_HASH = `0x${"9f".repeat(32)}`;
const SLIP_HASH = `0x${"b2".repeat(32)}`;
const RELEASE_TX = `0x${"c3".repeat(32)}`;

function discover(hash: string, title: string, online: string): string {
  return [hash.slice(0, 10), title, "0.01 USDC", "escrow", online].join("  ");
}

describe("the discover line", () => {
  test("finds use-arc by the offer hash's first ten characters", () => {
    const stdout = [
      discover(OTHER_HASH, "weather", "online"),
      discover(OFFER_HASH, "use-arc", "online"),
      "",
    ].join("\n");
    const line = useArcDiscoverLine(stdout, OFFER_HASH);
    expect(line).toBe(discover(OFFER_HASH, "use-arc", "online"));
    expect(line.startsWith(OFFER_HASH.slice(0, 10))).toBe(true);
  });

  test("refuses a use-arc line under another hash", () => {
    const stdout = discover(OTHER_HASH, "use-arc", "online");
    expect(() => useArcDiscoverLine(stdout, OFFER_HASH)).toThrow("no use-arc online line");
  });

  test("refuses a use-arc line that is offline", () => {
    const stdout = discover(OFFER_HASH, "use-arc", "offline");
    expect(() => useArcDiscoverLine(stdout, OFFER_HASH)).toThrow("no use-arc online line");
  });
});

describe("the MCP buy result", () => {
  const body = {
    output: { content: "# use-arc\nA worked example." },
    slipHash: SLIP_HASH,
    releaseTx: RELEASE_TX,
    explorer: `https://explorer.testnet.arc.io/tx/${RELEASE_TX}`,
    slip: { hash: SLIP_HASH, body: { jobId: `0x${"d4".repeat(32)}` } },
  };

  test("parses one text item into the output, slip and release", () => {
    const reply = parseMcpBuy([{ type: "text", text: JSON.stringify(body) }]);
    expect(reply.slipHash).toBe(SLIP_HASH);
    expect(reply.releaseTx).toBe(RELEASE_TX);
    expect(reply.explorer).toBe(body.explorer);
    expect(reply.output).toEqual(body.output);
    expect(reply.slip).toEqual(body.slip);
  });

  test("refuses a result without exactly one content item", () => {
    expect(() => parseMcpBuy([])).toThrow("not one");
    expect(() => parseMcpBuy([{ type: "text", text: JSON.stringify(body) }, { type: "text", text: "extra" }])).toThrow("not one");
  });

  test("refuses a result with no release transaction", () => {
    const { releaseTx: _releaseTx, ...withoutRelease } = body;
    expect(() => parseMcpBuy([{ type: "text", text: JSON.stringify(withoutRelease) }])).toThrow("no releaseTx");
  });

  test("refuses a result that is not JSON", () => {
    expect(() => parseMcpBuy([{ type: "text", text: "Released. Slip minted." }])).toThrow("not JSON");
  });
});

describe("the MCP verify_slip result", () => {
  test("reads the verifier's JSON verdict", () => {
    expect(mcpVerdict(JSON.stringify({ valid: true, findings: [], skipped: [] }))).toBe("VALID");
    expect(mcpVerdict(JSON.stringify({ valid: false, findings: [{ ok: false }], skipped: [] }))).toBe("INVALID");
  });

  test("reads a CLI-style last line", () => {
    expect(mcpVerdict("ok  hash  slip hash\nVALID\n")).toBe("VALID");
    expect(mcpVerdict("FAIL onchain ...\nINVALID\n")).toBe("INVALID");
  });

  test("refuses an answer with no verdict", () => {
    expect(() => mcpVerdict("something else")).toThrow("no verdict");
  });
});
