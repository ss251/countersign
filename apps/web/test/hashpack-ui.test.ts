import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { hashpackEnabled } from "../src/lib/hashpack.ts";
import { HashPackControls } from "../src/ui/WalletButton.tsx";
import type { Listing } from "../src/lib/types.ts";

// Assistant's route imports Vite's import.meta.glob, which Bun does not run; the card itself does
// not need the router, so the route table is stubbed before the module loads.
mock.module(new URL("../src/app/routes.ts", import.meta.url).pathname, () => ({
  hasRoute: () => false,
  VIEWS: [],
  resolve: () => null,
}));
const { HashPackPay, hashpackCanPay } = await import("../src/routes/assistant/Assistant.tsx");

const listing = {
  hash: `0x${"ab".repeat(32)}`,
  offer: {
    v: 1,
    seller: "0x00000000000000000000000000000000000000a1",
    title: "Hedera transfer builder",
    summary: "Builds a transfer.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "30000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: "0.0.11337065" },
    issuedAt: 1_793_957_000,
  },
  seller: { name: "builder" },
  status: "listed",
  online: true,
} as Listing;

function controls(over: { enabled: boolean; status: "disconnected" | "connecting" | "connected" | "error"; accountId?: string | null }) {
  return renderToString(
    createElement(HashPackControls, {
      enabled: over.enabled,
      status: over.status,
      accountId: over.accountId ?? null,
      error: over.status === "error" ? "HashPack did not connect." : null,
      onConnect: () => {},
      onDisconnect: () => {},
    }),
  );
}

describe("the HashPack switch", () => {
  test("VITE_HASHPACK gates it: unset means no HashPack words at all", () => {
    expect(hashpackEnabled(undefined)).toBe(false);
    expect(hashpackEnabled("")).toBe(false);
    expect(hashpackEnabled("0")).toBe(false);
    expect(hashpackEnabled("1")).toBe(true);
    expect(hashpackEnabled(" 1 ")).toBe(true);
    expect(controls({ enabled: false, status: "disconnected" })).not.toContain("HashPack");
  });

  test("the built module reads VITE_HASHPACK at import time", async () => {
    const saved = process.env.VITE_HASHPACK;
    try {
      const load = (flag: string) => import(`../src/lib/hashpack.ts?flag=${flag}`);
      delete process.env.VITE_HASHPACK;
      expect((await load("off")).HASHPACK_ENABLED).toBe(false);
      process.env.VITE_HASHPACK = "1";
      expect((await load("on")).HASHPACK_ENABLED).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.VITE_HASHPACK;
      else process.env.VITE_HASHPACK = saved;
    }
  });

  test("switched on, it offers Connect HashPack in the wallet menu's own words", () => {
    const html = controls({ enabled: true, status: "disconnected" });
    expect(html).toContain("Connect HashPack");
    expect(html).toContain('data-testid="hashpack-connect"');
  });

  test("connected, it shows the account id and Disconnect", () => {
    const html = controls({ enabled: true, status: "connected", accountId: "0.0.123" });
    expect(html).toContain("HashPack · ");
    expect(html).toContain("0.0.123");
    expect(html).toContain("Disconnect");
  });
});

describe("the card's HashPack button", () => {
  test("only a hedera offer, with HashPack connected and the flag on", () => {
    expect(hashpackCanPay({ enabled: true, connected: true, rails: ["hedera"] })).toBe(true);
    expect(hashpackCanPay({ enabled: false, connected: true, rails: ["hedera"] })).toBe(false);
    expect(hashpackCanPay({ enabled: true, connected: false, rails: ["hedera"] })).toBe(false);
    expect(hashpackCanPay({ enabled: true, connected: true, rails: ["escrow"] })).toBe(false);
  });

  test("the button itself says Pay with HashPack", () => {
    expect(renderToString(createElement(HashPackPay, { listing, base: "https://hub.test" }))).toContain("Pay with HashPack");
  });
});
