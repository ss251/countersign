/**
 * Scripted proof for Circle CLI interop and discovery consumption (#25).
 *
 *   bun scripts/circle/interop.ts [--hub http://127.0.0.1:8787] [--out report.md]
 *
 * Needs a hub with at least one listed offer whose runner is online (README, "Run it
 * from a clean clone"). With GATEWAY_RAIL=1 on the hub, its offers also carry a Circle
 * Gateway option the Circle CLI can pay.
 *
 * 1. Reads the hub's catalogue with the buyer's reader.
 * 2. Runs the Circle CLI's discovery contract against the hub, in process, as
 *    @circle-fin/cli 1.2.3 does it: `services search` reads `items` from the top of the
 *    body; `services inspect <url>` looks the URL up with `?query=<url>&limit=1`, builds
 *    a probe body from `metadata.input.body`, and needs a 402 with options it can pay.
 * 3. Reads Circle's public catalogue and counts what this agent could pay.
 * 4. When a `circle` binary is on PATH (or CIRCLE_CLI names one), runs the real
 *    `circle services search` and `circle services inspect` against the hub through
 *    CIRCLE_DISCOVERY_URL. Neither command needs a Circle login.
 *
 * Reads only: nothing is signed or paid. Exits 1 when a check fails.
 */

import { writeFileSync } from "node:fs";
import { KNOWN_RAILS } from "../../packages/buyer/src/known-rails.ts";
import { CIRCLE_CATALOGUE, payableVia, readCatalogue, type CatalogueItem } from "../../packages/buyer/src/catalogue.ts";

type Json = Record<string, unknown>;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const hub = (flag("hub") ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const list = `${hub}/discovery/resources`;
const lines: string[] = [`# Circle interop proof`, ``, `- hub: ${hub}`, `- at: ${new Date().toISOString()}`, ``];
let failed = 0;

function check(ok: boolean, what: string, detail = ""): boolean {
  if (!ok) failed++;
  lines.push(`- ${ok ? "ok" : "FAIL"} · ${what}${detail ? ` · ${detail}` : ""}`);
  return ok;
}
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// Arc testnet is the only chain a countersign hub's Circle-payable option sits on today.
const ARC_USDC = "0x3600000000000000000000000000000000000000";
function circleCliSupports(req: Json): boolean {
  if (req.network !== "eip155:5042002" || String(req.asset).toLowerCase() !== ARC_USDC) return false;
  const extra = isRecord(req.extra) ? req.extra : {};
  if (extra.name === "GatewayWalletBatched" && extra.version === "1") return true;
  return req.scheme === "exact" && (extra.assetTransferMethod === undefined || extra.assetTransferMethod === "eip3009");
}

/** Required fields only, like the CLI's json-schema-faker with alwaysFakeOptionals off. */
function sample(schema: unknown): unknown {
  if (!isRecord(schema)) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case "object": {
      const out: Json = {};
      const props = isRecord(schema.properties) ? schema.properties : {};
      for (const key of Array.isArray(schema.required) ? schema.required : []) out[key] = sample(props[key]);
      return out;
    }
    case "array": return [];
    case "string": return "example";
    case "number": case "integer": return 1;
    case "boolean": return true;
    default: return null;
  }
}

function decode402(res: Response, body: unknown): Json | undefined {
  const header = res.headers.get("payment-required");
  if (header) return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Json;
  return isRecord(body) && Array.isArray(body.accepts) ? body : undefined;
}

async function cliContract(item: CatalogueItem): Promise<void> {
  const tag = item.metadata.offerHash?.slice(0, 10) ?? item.resource;
  lines.push(``, `### ${tag}`, ``);

  const lookup = (await (await fetch(`${list}?query=${encodeURIComponent(item.resource)}&limit=1&siwx=false`)).json()) as Json;
  const found = Array.isArray(lookup.items) ? (lookup.items as Json[]).find((i) => i.resource === item.resource) : undefined;
  check(found !== undefined, "inspect's lookup by URL finds this offer");

  const meta = isRecord(found?.metadata) ? found.metadata : {};
  const input = isRecord(meta.input) ? meta.input : {};
  const probe = sample(input.body);
  const res = await fetch(item.resource, { method: String(meta.method ?? "POST"), headers: { "content-type": "application/json" }, body: JSON.stringify(probe) });
  const body = await res.json().catch(() => null);
  if (!check(res.status === 402, "probe from metadata.input.body reaches the 402", `HTTP ${res.status}`)) {
    if (res.status === 503) lines.push(`  - the seller's runner is offline; start it and run again`);
    return;
  }
  const required = decode402(res, body);
  const accepts = Array.isArray(required?.accepts) ? (required.accepts as Json[]) : [];
  check(accepts.length > 0, "the 402 carries payment options", `${accepts.length}`);
  const extensions = isRecord(required?.extensions) ? required.extensions : {};
  const blocking = Object.entries(extensions).filter(([, v]) => isRecord(v) && isRecord(v.info) && v.info.required === true);
  check(blocking.length === 0, "no extension the CLI would refuse as required");
  for (const req of accepts) {
    const extra = isRecord(req.extra) ? req.extra : {};
    const kind = extra.name === "GatewayWalletBatched" ? "gateway" : String(req.scheme);
    lines.push(`  - option ${kind} on ${String(req.network)}, ${String(req.amount)} atomic: Circle CLI ${circleCliSupports(req) ? "can pay" : "cannot pay (expected for countersign escrow)"}`);
  }
  const via = payableVia(item, KNOWN_RAILS);
  lines.push(`  - countersign buyer: ${via ? `pays via ${via.kind}` : "no pinned rail"}`);
}

function circleBinary(): string | undefined {
  return process.env.CIRCLE_CLI ?? Bun.which("circle") ?? undefined;
}

function runCli(bin: string, cliArgs: string[]): { code: number; out: string } {
  const run = Bun.spawnSync([bin, ...cliArgs], { env: { ...process.env, CIRCLE_DISCOVERY_URL: list }, stdout: "pipe", stderr: "pipe" });
  return { code: run.exitCode ?? 1, out: `${run.stdout.toString()}${run.stderr.toString()}`.trim() };
}

/** The CLI's JSON output, unwrapped from an envelope if it has one. */
function cliJson(out: string): Json | undefined {
  try {
    const parsed = JSON.parse(out) as unknown;
    if (!isRecord(parsed)) return undefined;
    return isRecord(parsed.data) ? parsed.data : parsed;
  } catch {
    return undefined;
  }
}

async function realCli(items: CatalogueItem[]): Promise<void> {
  lines.push(``, `## The real Circle CLI`, ``);
  const bin = circleBinary();
  if (!bin) {
    lines.push(`- skipped: no \`circle\` on PATH. Install \`@circle-fin/cli\` or set CIRCLE_CLI, then run again.`);
    return;
  }
  const version = runCli(bin, ["--version"]);
  lines.push(`- binary: ${bin} (${version.out.split("\n")[0]})`);

  const quiet = runCli(bin, ["services", "search", "-q"]);
  const urls = new Set(quiet.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  check(quiet.code === 0 && items.every((i) => urls.has(i.resource)), "`circle services search -q` lists every hub offer", `${urls.size} urls`);

  for (const item of items) {
    const ins = runCli(bin, ["services", "inspect", item.resource, "--output", "json"]);
    const result = cliJson(ins.out);
    check(result?.status === "payable", `\`circle services inspect\` sees ${item.metadata.offerHash?.slice(0, 10)} as payable`, String(result?.status ?? ins.out.split("\n")[0]));
    const provider = isRecord(result?.provider) ? result.provider : {};
    check(provider.name === "countersign", "inspect read the hub's discovery metadata");
    lines.push(`  - clientSupport: ${String(result?.clientSupport ?? "-")}, scheme ${String(result?.scheme ?? "-")}, transfer ${String(result?.assetTransferMethod ?? "-")}`);
  }
}

async function main(): Promise<void> {
  lines.push(`## The hub's catalogue, read by the buyer`, ``);
  const page = await readCatalogue(list, { limit: 200 });
  check(page.items.length > 0, "the hub lists offers in Circle's shape", `${page.items.length} of ${page.total}`);

  const raw = (await (await fetch(`${list}?siwx=false`)).json()) as Json;
  check(Array.isArray(raw.items), "`items` sits at the top of the body, where `circle services search` reads it");

  lines.push(``, `## The Circle CLI's contract, in process`);
  for (const item of page.items.slice(0, 3)) await cliContract(item);

  lines.push(``, `## Circle's public catalogue, read by the buyer`, ``);
  const circle = await readCatalogue(CIRCLE_CATALOGUE, { limit: 200 });
  const networks = new Map<string, number>();
  for (const item of circle.items) for (const req of item.accepts) networks.set(req.network, (networks.get(req.network) ?? 0) + 1);
  const payable = circle.items.filter((item) => payableVia(item, KNOWN_RAILS)).length;
  check(circle.items.length > 0, "the buyer reads Circle's catalogue", `${circle.items.length} of ${circle.total}`);
  lines.push(`- networks in the first page: ${[...networks].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(", ")}`);
  lines.push(`- payable by this agent's pinned rails: ${payable}`);

  await realCli(page.items.slice(0, 3));

  lines.push(``, failed === 0 ? `All checks passed.` : `${failed} check(s) failed.`);
  const report = lines.join("\n");
  console.log(report);
  const out = flag("out");
  if (out) writeFileSync(out, `${report}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
