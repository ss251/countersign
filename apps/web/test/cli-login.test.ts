import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FOREIGN_HUB, HubError, hubPost } from "../src/lib/hub.ts";
import { approveCliLogin, readCode, type ApproveOutcome } from "../src/routes/cli-login/approve.ts";
import { CliLoginView, type CliSignIn } from "../src/routes/cli-login/View.tsx";
import { claimApproval, loginSettled, type LoginPhase } from "../src/routes/cli-login/View.tsx";

const CODE = "ABCD-1234";
const PRIVY = "eyJ.victim-privy-access-token.sig";
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const EVIL = "https://evil.example";

type Sent = { path: string; body: unknown; headers: Record<string, string> };

function answered(answer: unknown, sent?: Sent[]) {
  return async (path: string, body: unknown, headers: Record<string, string>) => {
    sent?.push({ path, body, headers });
    return answer;
  };
}

function failed(error: unknown) {
  return async () => {
    throw error;
  };
}

function approve(post: (path: string, body: unknown, headers: Record<string, string>) => Promise<unknown>) {
  return approveCliLogin({ post, privyToken: PRIVY, code: CODE });
}

describe("readCode", () => {
  test("takes a trimmed, uppercased code when it has the right shape", () => {
    expect(readCode(new URLSearchParams("code=abcd-1234"))).toBe(CODE);
    expect(readCode(new URLSearchParams("code=%20AbCd-1234%20"))).toBe(CODE);
  });

  test("refuses anything else", () => {
    expect(readCode(new URLSearchParams("code=ABCD1234"))).toBeNull();
    expect(readCode(new URLSearchParams("code=AB-CD"))).toBeNull();
    expect(readCode(new URLSearchParams("code="))).toBeNull();
    expect(readCode(new URLSearchParams(""))).toBeNull();
  });
});

describe("approving a CLI login", () => {
  test("posts only the code and the Privy token", async () => {
    const sent: Sent[] = [];
    const outcome = await approve(answered({ address: ADDRESS }, sent));
    expect(sent).toEqual([
      { path: "/cli/login/approve", body: { code: CODE }, headers: { "x-privy-token": PRIVY } },
    ]);
    expect(outcome).toEqual({ kind: "approved", address: ADDRESS });
  });

  test("an answer without an address is still approved, with no address", async () => {
    expect(await approve(answered({}))).toEqual({ kind: "approved", address: null });
  });

  test("401 means the Privy session is gone", async () => {
    expect(await approve(failed(new HubError(401, "no valid session", "no-session")))).toEqual({
      kind: "signed-out",
    });
  });

  test("404 and 410 mean the code is unknown or expired", async () => {
    expect(await approve(failed(new HubError(404, "unknown code", "unknown")))).toEqual({ kind: "expired" });
    expect(await approve(failed(new HubError(410, "expired code", "expired")))).toEqual({ kind: "expired" });
  });

  test("status 0 says the hub did not answer", async () => {
    expect(await approve(failed(new HubError(0, "The hub did not answer.")))).toEqual({
      kind: "error",
      message: "The hub did not answer. Try again in a moment.",
    });
  });

  test("any other status says the hub could not connect the CLI", async () => {
    expect(await approve(failed(new HubError(500, "not for a message")))).toEqual({
      kind: "error",
      message: "The hub could not connect this CLI.",
    });
  });

  test("a foreign hub says why it refused", async () => {
    expect(await approve(failed(new HubError(403, FOREIGN_HUB, "foreign-hub")))).toEqual({
      kind: "error",
      message: FOREIGN_HUB,
    });
  });

  test("no failure message ever carries the token", async () => {
    const errors = [
      new HubError(401, `no session ${PRIVY}`, "no-session"),
      new HubError(404, `unknown ${PRIVY}`, "unknown"),
      new HubError(410, `expired ${PRIVY}`, "expired"),
      new HubError(0, `down ${PRIVY}`),
      new HubError(500, `${PRIVY} stayed in this body`),
      new HubError(403, FOREIGN_HUB, "foreign-hub"),
    ];
    for (const error of errors) {
      const outcome: ApproveOutcome = await approve(failed(error));
      expect(JSON.stringify(outcome)).not.toContain(PRIVY);
    }
  });
});

type Request = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
const realWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { window?: unknown }).window = realWindow;
});

/** A page at `hash`, with fetch captured, as in w1-privy-token-origin.test.ts. */
function pageAt(hash: string): Request[] {
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
  const sent: Request[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    return new Response(JSON.stringify({ address: ADDRESS }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}

describe("the Privy token stays with this console's own hub", () => {
  test("a CLI approval on a page opened with ?hub=<other> sends the token nowhere", async () => {
    const sent = pageAt(`#/cli-login?code=${CODE}&hub=${encodeURIComponent(EVIL)}`);
    const outcome = await approveCliLogin({
      post: (path, body, headers) => hubPost(path, body, headers),
      privyToken: PRIVY,
      code: CODE,
    });
    expect(outcome).toEqual({ kind: "error", message: FOREIGN_HUB });
    const leaked = sent.filter(
      (request) => request.url.startsWith(EVIL) && Object.keys(request.headers).some((h) => h.toLowerCase() === "x-privy-token"),
    );
    expect(leaked).toEqual([]);
  });
});

function view(props: { code: string | null; signIn: CliSignIn | null; reason?: string }) {
  return renderToString(createElement(CliLoginView, props));
}

const signedOut: CliSignIn = {
  ready: true,
  authenticated: false,
  login: () => undefined,
  getAccessToken: async () => null,
};

describe("the CLI login view", () => {
  test("with a valid code, it shows the code, the warning and why sign-in is unavailable", () => {
    const html = view({ code: CODE, signIn: null, reason: FOREIGN_HUB });
    expect(html).toContain('data-testid="cli-code"');
    expect(html).toContain(CODE);
    expect(html).toContain("Check that this code matches the one in your terminal.");
    expect(html).toContain(
      "Never approve a code you did not start yourself: whoever started it gets your agent wallet&#x27;s session.",
    );
    expect(html).toContain(FOREIGN_HUB.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("Connect this CLI");
  });

  test("a valid code warns against a link someone else sent", () => {
    const html = view({ code: CODE, signIn: signedOut });
    expect(html).toContain("If you did not just run countersign login yourself, close this page.");
    expect(view({ code: null, signIn: null, reason: FOREIGN_HUB })).not.toContain(
      "If you did not just run countersign login yourself",
    );
  });

  test("with no code, it shows only the error line", () => {
    const html = view({ code: null, signIn: null, reason: FOREIGN_HUB });
    expect(html).toContain("This page needs the code your terminal printed. Run countersign login again.");
    expect(html).not.toContain("Connect this CLI");
    expect(html).not.toContain('data-testid="cli-code"');
    expect(html).not.toContain("Check that this code matches");
    expect(html).not.toContain("Never approve");
    expect(html).not.toContain(FOREIGN_HUB.replaceAll("'", "&#x27;"));
  });

  test("with sign-in available, it offers the button", () => {
    const html = view({ code: CODE, signIn: signedOut });
    expect(html).toContain("Connect this CLI");
    expect(html).toContain("Check that this code matches the one in your terminal.");
  });
});

describe("a dismissed CLI sign-in", () => {
  test("clears pending and does not approve a later sign-in from the top bar", async () => {
    const dismissed: CliSignIn = { ...signedOut, login: async () => false };
    let phase: LoginPhase = "pending";
    phase = loginSettled(await dismissed.login());
    expect(phase).toBe("idle");

    let approvals = 0;
    const authenticatedChanged = (authenticated: boolean) => {
      const step = claimApproval(phase, authenticated);
      phase = step.phase;
      if (step.approve) approvals += 1;
    };
    authenticatedChanged(true);
    authenticatedChanged(true);

    expect(approvals).toBe(0);
  });

  test("approves once when the sign-in this page started completes", async () => {
    const completed: CliSignIn = { ...signedOut, login: async () => true };
    let phase: LoginPhase = "pending";
    phase = loginSettled(await completed.login());

    let approvals = 0;
    const authenticatedChanged = (authenticated: boolean) => {
      const step = claimApproval(phase, authenticated);
      phase = step.phase;
      if (step.approve) approvals += 1;
    };
    authenticatedChanged(false);
    authenticatedChanged(true);
    authenticatedChanged(true);

    expect(approvals).toBe(1);
  });
});

describe("the CLI login source", () => {
  const dir = new URL("../src/routes/cli-login/", import.meta.url);

  test("never logs", () => {
    const files = readdirSync(dir.pathname).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(readFileSync(new URL(file, dir), "utf8")).not.toContain("console.");
    }
  });
});
