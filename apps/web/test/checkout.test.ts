import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { PAYMENT_REQUIRED_HEADER, fromBase64Json } from "@countersign/core";

const root = join(import.meta.dir, "../../..");
const MERCHANT = getAddress("0x5555555555555555555555555555555555555555");
const NO_CHECKOUT = "This console has no Whitechain checkout configured.";

const children: Array<{ kill: () => void }> = [];

afterEach(() => {
  while (children.length > 0) children.pop()!.kill();
});

function environment(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port!;
  server.stop(true);
  return port;
}

async function start(overrides: Record<string, string | undefined>): Promise<string> {
  const port = await freePort();
  const child = Bun.spawn(["bun", "apps/web/server.ts"], {
    cwd: root,
    env: environment({ ...overrides, PORT: String(port) }),
    stdout: "ignore",
    stderr: "ignore",
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return base;
    } catch {
      // The server has not bound the port yet.
    }
    await Bun.sleep(50);
  }
  throw new Error("the console did not start");
}

describe("the checkout snippet", () => {
  test("both files hold twenty non-empty lines or fewer", () => {
    const files = ["checkout-merchant.ts", "checkout-customer.ts"];
    const lines = files.reduce((total, name) => {
      const text = readFileSync(join(root, "examples/whitechain", name), "utf8");
      return total + text.split(/\r?\n/).filter((line) => line.trim() !== "").length;
    }, 0);
    expect(lines).toBeLessThanOrEqual(20);
  });

  test("the console imports the merchant snippet", () => {
    const source = readFileSync(join(root, "apps/web/server.ts"), "utf8");
    expect(source).toContain("examples/whitechain/checkout-merchant.ts");
  });
});

describe("the console's checkout", () => {
  test("an unpaid request names the merchant and the price", async () => {
    const base = await start({
      WC_MERCHANT_ADDRESS: MERCHANT,
      RELAY_URL: "http://127.0.0.1:9",
    });

    const response = await fetch(`${base}/checkout/sticker-pack`);
    expect(response.status).toBe(402);

    const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
    expect(header).not.toBeNull();
    const required = fromBase64Json<{
      accepts: Array<{ payTo: string; amount: string; network: string }>;
    }>(header!);
    expect(required.accepts[0]).toMatchObject({
      payTo: MERCHANT,
      amount: "10000",
      network: "eip155:1874",
    });
  });

  test("without a merchant address it answers no-checkout", async () => {
    const base = await start({
      WC_MERCHANT_ADDRESS: undefined,
      RELAY_URL: "http://127.0.0.1:9",
    });

    const response = await fetch(`${base}/checkout/sticker-pack`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "no-checkout",
      message: NO_CHECKOUT,
    });
  });
});
