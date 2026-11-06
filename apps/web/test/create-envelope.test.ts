import { describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WalletModeContext } from "../src/app/Providers.tsx";
import { HubError } from "../src/lib/hub.ts";
import { createSessionEnvelope, type SessionPost } from "../src/routes/buyer/session.ts";

// The same shape as buyer-locked.test.ts's mock: routes.ts uses Vite's import.meta.glob.
mock.module(new URL("../src/app/routes.ts", import.meta.url).pathname, () => ({ hasRoute: () => true, VIEWS: [] }));
const { TokenGate } = await import("../src/routes/buyer/Approvals.tsx");

const AGENT = "0x1234567890abcdef1234567890abcdef12345678";
const PRIVY = "privy-session-token";

/** A session call whose answer and remembered values the test can inspect. */
function session(post: SessionPost) {
  const tokens: string[] = [];
  const agents: string[] = [];
  const call = createSessionEnvelope({
    post,
    privyToken: PRIVY,
    agent: AGENT,
    rememberToken: (t) => tokens.push(t),
    rememberAgent: (a) => agents.push(a),
  });
  return { call, tokens, agents };
}

describe("creating an envelope session", () => {
  test("asks the hub once, with the agent and the Privy token, and nothing else", async () => {
    const calls: Array<{ path: string; body: unknown; headers: Record<string, string> }> = [];
    const { call } = session(async (path, body, headers) => {
      calls.push({ path, body, headers });
      return { agent: AGENT, envelope: {}, issued: true, token: "cse_test", tokenExpiresAt: 0 };
    });
    await call;
    expect(calls).toEqual([
      { path: "/envelopes/session", body: { agent: AGENT }, headers: { "x-privy-token": PRIVY } },
    ]);
  });

  test("keeps the token the hub issued and follows the agent it named", async () => {
    const { call, tokens, agents } = session(async () => ({
      agent: AGENT,
      envelope: {},
      issued: true,
      token: "cse_test",
      tokenExpiresAt: 0,
    }));
    expect(await call).toEqual({ kind: "created", agent: AGENT });
    expect(tokens).toEqual(["cse_test"]);
    expect(agents).toEqual([AGENT]);
  });

  test("a 401 means the Privy session is gone, and nothing is remembered", async () => {
    const { call, tokens, agents } = session(async () => {
      throw new HubError(401, "no valid session", "no-session");
    });
    expect(await call).toEqual({ kind: "signed-out" });
    expect(tokens).toEqual([]);
    expect(agents).toEqual([]);
  });

  test("status 0 says the hub did not answer", async () => {
    const { call } = session(async () => {
      throw new HubError(0, "The hub did not answer.");
    });
    expect(await call).toEqual({ kind: "error", message: "The hub did not answer. Try again in a moment." });
  });

  test("any other status says the envelope could not be created", async () => {
    const { call } = session(async () => {
      throw new HubError(500, "cse_secret stayed in this body");
    });
    expect(await call).toEqual({ kind: "error", message: "The hub could not create the envelope." });
  });

  test("an answer with no token is refused, and nothing is remembered", async () => {
    const { call, tokens, agents } = session(async () => ({ agent: AGENT, envelope: {}, issued: true }));
    expect(await call).toEqual({ kind: "error", message: "The hub's answer had no token, so nothing was saved." });
    expect(tokens).toEqual([]);
    expect(agents).toEqual([]);
  });

  test("a token beside an address that is not an agent is refused too", async () => {
    const { call, tokens, agents } = session(async () => ({ agent: "not-an-address", token: "cse_secret" }));
    expect(await call).toEqual({ kind: "error", message: "The hub's answer had no token, so nothing was saved." });
    expect(tokens).toEqual([]);
    expect(agents).toEqual([]);
  });

  test("no failure message ever carries the token", async () => {
    const answers: SessionPost[] = [
      async () => {
        throw new HubError(500, "cse_secret");
      },
      async () => ({ token: "cse_secret", agent: "not-an-address" }),
    ];
    for (const post of answers) {
      const outcome = await session(post).call;
      expect(outcome.kind).toBe("error");
      if (outcome.kind === "error") expect(outcome.message).not.toContain("cse_");
    }
  });
});

describe("the locked phone's way in", () => {
  test("with sign-in off, it says so and keeps the token field as the open secondary option", () => {
    const html = renderToString(
      createElement(
        WalletModeContext.Provider,
        { value: { privy: false, reason: null } },
        createElement(TokenGate, { rejected: false, onOpen: () => {} }),
      ),
    );
    expect(html).toContain("Paste a token instead");
    expect(html).toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Email sign-in is off on this console");
    expect(html).not.toContain("Paste the token first.");
  });
});

describe("the create-envelope source", () => {
  const buyerDir = new URL("../src/routes/buyer/", import.meta.url);
  const read = (name: string) => Bun.file(new URL(name, buyerDir)).text();

  test("session.ts and Approvals.tsx never log", async () => {
    expect(await read("session.ts")).not.toContain("console.");
    expect(await read("Approvals.tsx")).not.toContain("console.");
  });

  test("Approvals.tsx carries the action and both sentences, exactly", async () => {
    const source = await read("Approvals.tsx");
    expect(source).toContain("Create an envelope");
    expect(source).toContain(
      "An envelope is the set of spending limits you give your agent: how much it may spend in all, how much per seller, and above what amount it must ask you first.",
    );
    expect(source).toContain("Create one here and this phone gets the token that opens your agent's approvals.");
  });

  test("no buyer screen puts a token in a URL", () => {
    const files = readdirSync(buyerDir.pathname).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const file of files) {
      expect(readFileSync(new URL(file, buyerDir), "utf8")).not.toContain("token=");
    }
  });
});
