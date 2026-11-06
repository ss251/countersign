/**
 * The countersign console in production: the static build of apps/web behind one
 * small Bun server, with no dependencies.
 *
 * - Serves ./dist. Hashed assets are cached for a year, index.html never.
 * - Proxies /hub, /relay and /merchant-api to HUB_URL, RELAY_URL and MERCHANT_URL, so the
 *   page talks to one origin and no backend needs CORS for it. An unset upstream answers
 *   503 with a sentence; one that does not answer gives 502. The page shows both as
 *   "did not answer". It never falls back to fixtures.
 * - GET /healthz answers {ok: true} for the platform's health check.
 *
 *   PORT=8080 HUB_URL=http://127.0.0.1:8787 bun apps/web/server.ts
 */

import { join, normalize, sep } from "node:path";

const root = join(import.meta.dir, "dist");
const port = Number(process.env.PORT ?? 8080);

const upstreams: Array<[prefix: string, name: string, target: string | undefined]> = [
  ["/hub", "hub", process.env.HUB_URL],
  ["/relay", "relayer", process.env.RELAY_URL],
  ["/merchant-api", "merchant service", process.env.MERCHANT_URL],
];

// Hop-by-hop headers, and the ones fetch rewrites on its own, never cross the proxy.
const DROP_REQUEST = ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "accept-encoding", "content-length"];
const DROP_RESPONSE = ["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"];

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

function sentence(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: SECURITY_HEADERS });
}

async function proxy(req: Request, url: URL, prefix: string, name: string, target: string | undefined): Promise<Response> {
  if (!target) return sentence(503, "no-upstream", `This console has no ${name} configured.`);
  const rest = url.pathname.slice(prefix.length) || "/";
  // Keep any path the target carries: HUB_URL=http://h/base sends /hub/x to http://h/base/x.
  const base = new URL(target);
  const dest = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}${rest}${url.search}`);
  const headers = new Headers(req.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  try {
    const res = await fetch(dest, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const out = new Headers(res.headers);
    for (const h of DROP_RESPONSE) out.delete(h);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch {
    return sentence(502, "upstream-down", `The ${name} did not answer.`);
  }
}

async function serveStatic(url: URL, head: boolean): Promise<Response> {
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return sentence(400, "bad-path", "That path does not decode.");
  }
  if (path.endsWith("/")) path += "index.html";
  const full = normalize(join(root, path));
  if (full !== root && !full.startsWith(root + sep)) return sentence(404, "not-found", "Nothing at this address.");

  let file = Bun.file(full);
  let name = path;
  if (!(await file.exists())) {
    // Routes live after the "#", so any other miss is a missing file, except the page itself.
    if (path.startsWith("/assets/")) return sentence(404, "not-found", "Nothing at this address.");
    file = Bun.file(join(root, "index.html"));
    name = "/index.html";
  }
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("content-type", file.type);
  headers.set("cache-control", name.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  return new Response(head ? null : file, { headers });
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return Response.json({ ok: true });
    for (const [prefix, name, target] of upstreams) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) return proxy(req, url, prefix, name, target);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sentence(405, "method", "Only GET and HEAD are served here.");
    return serveStatic(url, req.method === "HEAD");
  },
});

const wired = upstreams.map(([prefix, , t]) => `${prefix} -> ${t ?? "unset"}`).join(", ");
console.log(`countersign console on :${server.port} (${wired})`);
