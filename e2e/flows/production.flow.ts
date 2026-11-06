/**
 * 14a, 14b · Production smoke, plain HTTP only (STEER-1730). Production must run on the live hub
 * by default, with fixtures only on ?hub=off. These fail loudly the moment it slides back.
 *
 *   production-console: the console's default bundle names the production hub and carries
 *                       none of the fixture catalogue's stand-in values.
 *   production-hub:     every hub endpoint a console screen calls answers 200, and the hub is
 *                       open to the console's origin, preflight included.
 *
 * No browser: the bundle is fetched and read as text.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { check, equal, NotRun, type Flow, type FlowCtx } from "../lib/flow.ts";
import { ROOT } from "../lib/paths.ts";

const DEFAULT_CONSOLE = "https://web-production-a58de.up.railway.app";

function consoleUrl(): string {
  return (process.env.E2E_PUBLIC_WEB ?? DEFAULT_CONSOLE).replace(/\/+$/, "");
}

/** Files whose values exist only as stand-ins for screens with no live source. */
const FIXTURE_FILES = [
  "apps/web/src/fixtures/index.ts",
  "apps/web/src/fixtures/catalogue.json",
  "apps/web/src/fixtures/signed-slip.json",
  "apps/web/src/routes/merchant/fixtures.ts",
];

/** Where real values live; a hex value found here is not a fixture marker. */
const REAL_ROOTS = ["apps/hub/src", "packages", "contracts/deployments", "docs", "examples", "scripts", "apps/web/src"];

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|json|md|sol)$/.test(name)) out.push(path);
  }
}

/**
 * Hex values (addresses and 32-byte hashes) that appear in the fixture files and nowhere else
 * in the repository: if one is in the shipped bundle, the fixture catalogue shipped with it.
 */
export function fixtureMarkers(): string[] {
  return [...fixtureMarkerSources().keys()];
}

/** Each fixture-only value, with the fixture file it comes from. */
export function fixtureMarkerSources(): Map<string, string> {
  const fixturePaths = new Set(FIXTURE_FILES.map((f) => join(ROOT, f)));
  const found = new Map<string, string>();
  for (const f of fixturePaths) {
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) {
      if (!found.has(m[0].toLowerCase())) found.set(m[0].toLowerCase(), f.slice(ROOT.length + 1));
    }
  }
  const files: string[] = [];
  for (const r of REAL_ROOTS) walk(join(ROOT, r), files);
  const real = files.filter((f) => !fixturePaths.has(f) && !f.includes("/test/")).map((f) => readFileSync(f, "utf8").toLowerCase()).join("\n");
  for (const hex of [...found.keys()]) if (real.includes(hex)) found.delete(hex);
  return found;
}

async function text(ctx: FlowCtx, label: string, url: string): Promise<string> {
  const res = await ctx.http(label, url, { headers: { accept: "*/*" } });
  equal(res.status, 200, `${label} status (${url})`);
  return res.text;
}

export const productionConsole: Flow = {
  name: "production-console",
  title: "Production console is live by default",
  owner: "cs-ui",
  network: "none",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  async run(ctx) {
    const base = consoleUrl();
    const hub = (ctx.env.options.publicHub as string).replace(/\/+$/, "");

    const bundle = await ctx.step("the console serves its default bundle", async () => {
      const html = await text(ctx, "console index", `${base}/`);
      const srcs = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"|<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => (m[1] ?? m[2]) as string);
      check(srcs.length > 0, "the console index loads a module script");
      const parts: string[] = [];
      for (const src of srcs) parts.push(await text(ctx, `bundle ${src.split("/").pop()}`, new URL(src, `${base}/`).toString()));
      ctx.note(`default bundle: ${srcs.map((s) => s.split("/").pop()).join(", ")}`);
      return parts.join("\n");
    });

    await ctx.step("the default bundle is live, not fixtures", () => {
      // Both checks always run, so one red line names everything that is wrong.
      const problems: string[] = [];
      if (!bundle.includes(hub)) problems.push(`it does not contain ${hub}, so the console was built without VITE_HUB_URL and opens on fixtures`);
      const sources = fixtureMarkerSources();
      const markers = [...sources.keys()];
      if (markers.length === 0) problems.push("no fixture markers were found in the fixture sources, so the fixture check proves nothing");
      const shipped = markers.filter((m) => bundle.toLowerCase().includes(m));
      if (shipped.length > 0) {
        const byFile = new Map<string, number>();
        for (const m of shipped) byFile.set(sources.get(m) as string, (byFile.get(sources.get(m) as string) ?? 0) + 1);
        const lane = (f: string) => (f.startsWith("apps/web/src/routes/merchant/") ? "cs-wc" : "cs-ui");
        const where = [...byFile].map(([f, n]) => `${n} from ${f}, ${lane(f)}`).join("; ");
        problems.push(`${shipped.length} of ${markers.length} fixture-only values ship in it (${where}); load fixtures only on ?hub=off, by dynamic import`);
      }
      ctx.note(`fixture markers checked: ${markers.length}`);
      check(problems.length === 0, `the default bundle: ${problems.join("; ")}`);
    });
  },
};

interface Endpoint {
  screen: string;
  path: string;
}

export const productionHub: Flow = {
  name: "production-hub",
  title: "Production hub serves every screen",
  owner: "orch-cs",
  network: "none",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  async run(ctx) {
    const hub = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const origin = consoleUrl();

    const seen = await ctx.step("the hub has a listed offer and a settlement to read", async () => {
      const offers = await ctx.http("offers", `${hub}/offers`);
      equal(offers.status, 200, "offers status");
      const listed = ((offers.json as { offers?: Array<{ offerHash: string; offer: { seller: string }; status: string }> }).offers ?? []).filter((o) => o.status === "listed");
      check(listed.length > 0, "the production hub lists no offer");
      const st = await ctx.http("settlements", `${hub}/settlements?limit=1`);
      equal(st.status, 200, "settlements status");
      const latest = (st.json as { settlements?: Array<{ buyer?: string; slipHash?: string }> }).settlements?.[0];
      return {
        offerHash: listed[0]!.offerHash,
        seller: listed[0]!.offer.seller,
        // The console names its agent after the latest settlement's buyer; so does this check.
        agent: latest?.buyer ?? ctx.env.secrets.address("CS_BUYER_ADDRESS"),
        slipHash: latest?.slipHash,
      };
    });

    await ctx.step("production declares every rail it claims", async () => {
      const want = (process.env.E2E_PUBLIC_RAILS ?? "escrow,gateway,hedera,whitechain").split(",").map((x) => x.trim()).filter(Boolean);
      const res = await ctx.http("rails", `${hub}/rails`);
      equal(res.status, 200, "rails status");
      const ids = ((res.json as { rails?: Array<{ id: string }> }).rails ?? []).map((r) => r.id);
      const missing = want.filter((id) => !ids.includes(id));
      check(missing.length === 0, `production does not declare ${missing.join(", ")} (it declares ${ids.join(", ") || "none"})`);
    });

    await ctx.step("every endpoint a screen calls answers 200, open to the console", async () => {
      const q = (s: string) => encodeURIComponent(s);
      const endpoints: Endpoint[] = [
        { screen: "overview", path: "/offers" },
        { screen: "overview", path: "/rails" },
        { screen: "overview", path: "/settlements?limit=5" },
        { screen: "overview", path: "/stats" },
        { screen: "registry", path: "/sellers" },
        { screen: "registry, assistant", path: `/offers/search?q=${q("arc")}&limit=10` },
        { screen: "offer page", path: `/offers/${seen.offerHash}` },
        { screen: "buyer", path: `/jobs?buyer=${seen.agent}&limit=50` },
        { screen: "seller dashboard", path: `/jobs?seller=${seen.seller}&limit=50` },
        { screen: "merchant desk", path: `/orders?seller=${seen.seller}&limit=50` },
        ...(seen.slipHash ? [{ screen: "slip, verify", path: `/slips/${seen.slipHash}` }] : []),
      ];
      const failures: string[] = [];
      for (const e of endpoints) {
        const res = await ctx.http(`${e.screen} ${e.path.split("?")[0]}`, `${hub}${e.path}`, { headers: { origin } });
        const allow = res.headers.get("access-control-allow-origin");
        if (res.status !== 200) failures.push(`${res.status} ${e.path.split("?")[0]} (${e.screen})`);
        else if (allow !== "*" && allow !== origin) failures.push(`no CORS for the console on ${e.path.split("?")[0]} (${e.screen})`);
      }
      if (!seen.slipHash) failures.push("no settlement carries a slip hash to read (slip, verify)");
      ctx.note(`checked ${endpoints.length} endpoints for agent ${seen.agent} and seller ${seen.seller}`);
      ctx.note("the approval routes, /envelopes and /approvals, are checked by production-approvals: they depend on production's approver configuration");
      check(failures.length === 0, `${failures.length} of ${endpoints.length} fail: ${failures.join("; ")}`);
    });
  },
};

/**
 * 14c · The approval path on production: the envelope mirror and the approvals the buyer's phone
 * reads. They depend on production's approver configuration (`HUMAN_APPROVAL_TOKEN`). Until it is
 * set, the hub answers 503 `no-approver` and this flow reports NOT RUN (in progress). Once it is
 * set, every route must answer 200, open to the console, and the decision route must pass CORS
 * preflight with an `authorization` header.
 */
export const productionApprovals: Flow = {
  name: "production-approvals",
  title: "Production approval path for the buyer's phone",
  owner: "cs-ui",
  network: "none",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  async run(ctx) {
    const hub = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const origin = consoleUrl();
    const agent = await ctx.step("the agent the phone follows", async () => {
      const st = await ctx.http("settlements", `${hub}/settlements?limit=1`);
      equal(st.status, 200, "settlements status");
      return (st.json as { settlements?: Array<{ buyer?: string }> }).settlements?.[0]?.buyer ?? ctx.env.secrets.address("CS_BUYER_ADDRESS");
    });
    const paths = [`/envelopes/${agent}`, `/approvals?agent=${agent}&status=pending`, `/approvals?agent=${agent}&status=decided`];
    const read = async (label: string, auth: Record<string, string>) => {
      const out: Array<{ path: string; status: number; code?: string; allow: string | null }> = [];
      for (const path of paths) {
        const res = await ctx.http(`${label} ${path.split("?")[0]}`, `${hub}${path}`, { headers: { origin, ...auth } });
        out.push({ path, status: res.status, code: (res.json as { code?: string } | undefined)?.code, allow: res.headers.get("access-control-allow-origin") });
      }
      return out;
    };
    const anonymous = await ctx.step("the approval routes answer a client with no token", () => read("approvals, no token", {}));
    if (anonymous.every((a) => a.status === 503 && a.code === "no-approver")) {
      throw new NotRun("in progress: depends on production approver configuration (HUMAN_APPROVAL_TOKEN, STEER-1955 (c))");
    }
    await ctx.step("without the approver's token the routes refuse", () => {
      const open = anonymous.filter((a) => a.status !== 401);
      check(open.length === 0, `approval data answers a client with no token: ${open.map((a) => `${a.status} ${a.path.split("?")[0]}`).join("; ")}`);
    });
    if (!ctx.env.secrets.has("HUMAN_APPROVAL_TOKEN")) throw new NotRun("no approver token on this machine (approval.env)");
    // The console sends the human's token the same way (apps/web/src/lib/api.ts, tokenHeader).
    const answers = await ctx.step("with the approver's token the routes answer", () =>
      read("approvals, with token", { authorization: `Bearer ${ctx.env.secrets.get("HUMAN_APPROVAL_TOKEN")}` }),
    );
    await ctx.step("every approval route answers, open to the console", async () => {
      const bad: string[] = [];
      for (const a of answers) {
        const route = a.path.split("?")[0] as string;
        // An agent that never published its envelope mirror gets the documented 404, which the
        // phone shows as an honest absence; any other non-200 is a broken route.
        const honestAbsence = route.startsWith("/envelopes/") && a.status === 404 && a.code === "unknown-agent";
        if (honestAbsence) ctx.note(`the phone follows ${agent}, which has published no envelope mirror here, so the phone shows its absent state`);
        else if (a.status !== 200) bad.push(`${a.status}${a.code ? ` ${a.code}` : ""} ${route}`);
        if (a.allow !== "*" && a.allow !== origin) bad.push(`no CORS for the console on ${route}`);
      }
      // An agent that did publish its mirror is served: the EVM buyer's.
      const buyer = ctx.env.secrets.address("CS_BUYER_ADDRESS");
      const mirror = await ctx.http("envelope of the EVM buyer", `${hub}/envelopes/${buyer}`, {
        headers: { origin, authorization: `Bearer ${ctx.env.secrets.get("HUMAN_APPROVAL_TOKEN")}` },
      });
      if (mirror.status !== 200) bad.push(`${mirror.status} /envelopes/${buyer} (a published mirror)`);
      else equal((mirror.json as { envelope?: { agent?: string } }).envelope?.agent?.toLowerCase(), buyer.toLowerCase(), "the mirror's agent");
      check(bad.length === 0, `${bad.length} fail: ${bad.join("; ")}`);
    });
    await ctx.step("the approval decision passes CORS preflight", async () => {
      const res = await ctx.http("approval decision preflight", `${hub}/approvals/preflight-check/decision`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
      });
      check(res.status >= 200 && res.status < 300, `preflight status ${res.status}`);
      const allow = res.headers.get("access-control-allow-origin");
      check(allow === "*" || allow === origin, `preflight allow-origin ${allow}`);
      const headers = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      check(headers === "*" || headers.includes("authorization"), `preflight allows the authorization header (got "${headers}")`);
    });
  },
};
