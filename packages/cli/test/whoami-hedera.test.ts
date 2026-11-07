import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWhoami } from "../src/login.ts";
import { fileSessionBackend, type Session } from "../src/session.ts";

const TOKEN = "session-token-7f3a9c";
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const HUB = "https://hub.test";
const SESSION: Session = {
  token: TOKEN,
  hub: HUB,
  address: ADDRESS,
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
};

interface Call {
  url: string;
  method: string;
  authorization: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recorder(handler: (url: string) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
    });
    return handler(request.url);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let tmp: string;
let savedExitCode: typeof process.exitCode;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "countersign-whoami-"));
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.exitCode = savedExitCode;
});

async function whoami(handler: (url: string) => Response | Promise<Response>): Promise<{
  text: string;
  calls: Call[];
}> {
  const backend = fileSessionBackend(join(tmp, "config"));
  backend.write(SESSION);
  const out: string[] = [];
  const { fetchImpl, calls } = recorder(handler);
  await runWhoami([], {
    backend,
    hub: HUB,
    write: (t) => out.push(t),
    fetchImpl,
    balances: async () => "12.5 USDC on Arc",
  });
  return { text: out.join(""), calls };
}

describe("whoami and the hedera account", () => {
  test("a session with no hedera account provisions one and prints both lines", async () => {
    const { text, calls } = await whoami((url) => {
      if (url === `${HUB}/cli/session`) {
        return json({ address: ADDRESS, expiresAt: SESSION.expiresAt, hedera: null });
      }
      if (url === `${HUB}/cli/hedera/account`) {
        return json({ accountId: "0.0.4242", publicKey: "302a300506032b6570" });
      }
      return json({}, 404);
    });

    expect(text).toContain("Hedera account: 0.0.4242\n");
    expect(text).toContain(
      "Fund it with testnet USDC at https://faucet.circle.com (network: Hedera Testnet). No HBAR is needed: the facilitator pays the fee.\n",
    );
    expect(calls.map((call) => call.url)).toEqual([`${HUB}/cli/session`, `${HUB}/cli/hedera/account`]);
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(text).not.toContain(TOKEN);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("a hub with the feature off prints neither line", async () => {
    const { text } = await whoami((url) => {
      if (url === `${HUB}/cli/session`) {
        return json({ address: ADDRESS, expiresAt: SESSION.expiresAt, hedera: null });
      }
      return json({ code: "off", message: "Off." }, 404);
    });

    expect(text).not.toContain("Hedera account");
    expect(text).not.toContain("faucet.circle.com");
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("a hub that fails provisioning says so and still exits 0", async () => {
    const { text } = await whoami((url) => {
      if (url === `${HUB}/cli/session`) {
        return json({ address: ADDRESS, expiresAt: SESSION.expiresAt, hedera: null });
      }
      return json({ code: "privy-failed", message: "No." }, 502);
    });

    expect(text).toContain("Hedera account: not available right now.\n");
    expect(process.exitCode ?? 0).toBe(0);
  });

  test("a session that already has an account makes no provisioning call", async () => {
    const { text, calls } = await whoami(() =>
      json({ address: ADDRESS, expiresAt: SESSION.expiresAt, hedera: { accountId: "0.0.777" } }),
    );

    expect(text).toContain("Hedera account: 0.0.777\n");
    expect(calls.map((call) => call.url)).toEqual([`${HUB}/cli/session`]);
  });
});
