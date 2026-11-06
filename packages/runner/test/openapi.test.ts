import { describe, expect, test } from "bun:test";
import { runInChild } from "../src/child.ts";
import type { OpenApiSpec } from "../src/openapi.ts";

const LIMITS = { timeMs: 20_000, maxOutputBytes: 200_000 };
const SECRET = "planted-openapi-secret";

function listen(fetch: (request: Request) => Response | Promise<Response>) {
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
}

function spec(url: string, overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
  return {
    adapter: "openapi",
    url,
    method: "post",
    ...overrides,
  };
}

describe("runOpenApi", () => {
  test("returns the upstream JSON and sends the input as the body", async () => {
    const previous = process.env.CS_PLANTED_SECRET;
    process.env.CS_PLANTED_SECRET = SECRET;
    const server = listen(async (request) => {
      const body = await request.text();
      const headers = [...request.headers.entries()].map(([name, value]) => `${name}: ${value}`).join("\n");
      return Response.json({
        method: request.method,
        caller: request.headers.get("x-caller"),
        contentType: request.headers.get("content-type"),
        body: JSON.parse(body) as unknown,
        leaked: `${headers}\n${body}`.includes(SECRET),
      });
    });
    try {
      const input = { question: "hello", n: 2 };
      const output = await runInChild(
        spec(server.url.toString(), { headers: { "x-caller": "runner" } }),
        input,
        LIMITS,
      );
      expect(output).toEqual({
        method: "POST",
        caller: "runner",
        contentType: "application/json",
        body: input,
        leaked: false,
      });
    } finally {
      if (previous === undefined) delete process.env.CS_PLANTED_SECRET;
      else process.env.CS_PLANTED_SECRET = previous;
      server.stop(true);
    }
  });

  test("sends the input under bodyField", async () => {
    const server = listen(async (request) => Response.json({ body: await request.json() }));
    try {
      const output = await runInChild(spec(server.url.toString(), { bodyField: "payload" }), { n: 1 }, LIMITS);
      expect(output).toEqual({ body: { payload: { n: 1 } } });
    } finally {
      server.stop(true);
    }
  });

  test("refuses a non-2xx response", async () => {
    const server = listen(() => new Response("upstream broke", { status: 500 }));
    try {
      await expect(runInChild(spec(server.url.toString()), { n: 1 }, LIMITS)).rejects.toThrow(
        "Refused. The upstream responded with 500.",
      );
    } finally {
      server.stop(true);
    }
  });

  test("a hung upstream is refused at the timeout", async () => {
    let received = false;
    const server = listen(() => {
      received = true;
      return new Promise(() => undefined);
    });
    try {
      await expect(
        runInChild(spec(server.url.toString()), { n: 1 }, { timeMs: 6_000, maxOutputBytes: 100_000 }),
      ).rejects.toThrow(/time ceiling|upstream request timed out/);
      expect(received).toBe(true);
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("refuses a url that is not http or https", async () => {
    await expect(
      runInChild(
        { adapter: "openapi", url: "file:///etc/passwd", method: "GET" },
        {},
        LIMITS,
      ),
    ).rejects.toThrow("Refused. The upstream URL must be http or https.");
  });
});
