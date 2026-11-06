/**
 * 22 · The published npm packages, run from a clean directory the way a stranger would.
 * `npx -y @countersign-hub/cli@<version>` discovers the live use-arc offer on the default
 * (production) hub, buys it on Arc and verifies the slip. Then the CLI's own MCP server is
 * spawned by the MCP SDK client, which lists its tools, buys the same offer and verifies that
 * slip. Every child sees only a temporary HOME, an npm cache under the temporary directory and
 * PATH; the buyer key reaches only the children that need it.
 */

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { getAddress, type Address, type Hex } from "viem";
import { canonicalHash, type Offer } from "@countersign/core";
import { readJournal } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, escrowEvents, receipt, sameAddress } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { ROOT } from "../lib/paths.ts";
import { runCmd, type CmdResult } from "../lib/procs.ts";

const CLI = "@countersign-hub/cli";
const MCP = "@countersign-hub/mcp";
/** What npm would install when the flow runs. */
const VERSION = process.env.E2E_NPM_VERSION ?? "latest";
/** The use-arc price; the two buys make the flow's 0.02 USDC spend. */
const MAX_PRICE = units("0.01", 6);
const SPEND = units("0.02", 6);
const FLOOR = units("0.10", 6);
const HASH = /^0x[0-9a-fA-F]{64}$/;

const TOOL_NAMES = ["buy", "envelope_show", "get_offer", "journal", "search_offers", "verify_slip"];

interface CleanDir {
  dir: string;
  home: string;
  state: string;
}

interface PublicListing {
  offerHash: Hex;
  offer: Offer;
  online: boolean;
  status: string;
}

interface Rail {
  id: string;
  network: string;
  escrow?: string;
}

export interface McpContent {
  type: string;
  text?: string;
}

export interface McpBuyReply {
  output: unknown;
  slipHash: string;
  releaseTx: string;
  explorer?: string | null;
  slip?: unknown;
}

interface McpToolResult {
  isError?: boolean;
  content?: McpContent[];
}

interface McpClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>;
  close(): Promise<void>;
}

interface McpClientConstructor {
  new (info: { name: string; version: string }): McpClient;
}

interface McpTransport {
  stderr: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } | null;
}

interface McpTransportConstructor {
  new (params: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    stderr?: "pipe";
  }): McpTransport;
}

/** The first discover line for this offer: it starts with the hash's first ten characters. */
export function useArcDiscoverLine(stdout: string, offerHash: string): string {
  const prefix = offerHash.slice(0, 10).toLowerCase();
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .find((l) => {
      const text = l.trimStart().toLowerCase();
      return text.startsWith(prefix) && text.includes("use-arc") && /\bonline\b/.test(text);
    });
  if (!line) throw new Error(`countersign discover printed no use-arc online line starting ${prefix}`);
  return line;
}

/** The MCP buy tool answers one text item holding `{ output, slipHash, releaseTx, explorer, slip }`. */
export function parseMcpBuy(content: readonly McpContent[]): McpBuyReply {
  if (content.length !== 1) throw new Error(`the MCP buy result has ${content.length} content items, not one`);
  const item = content[0];
  if (!item || item.type !== "text" || typeof item.text !== "string") {
    throw new Error("the MCP buy result is not one text item");
  }
  let body: unknown;
  try {
    body = JSON.parse(item.text);
  } catch {
    throw new Error("the MCP buy result is not JSON");
  }
  if (typeof body !== "object" || body === null) throw new Error("the MCP buy result is not a JSON object");
  const value = body as Record<string, unknown>;
  if (typeof value.slipHash !== "string" || !HASH.test(value.slipHash)) {
    throw new Error("the MCP buy result has no slipHash");
  }
  if (typeof value.releaseTx !== "string" || !HASH.test(value.releaseTx)) {
    throw new Error("the MCP buy result has no releaseTx");
  }
  return {
    output: value.output,
    slipHash: value.slipHash,
    releaseTx: value.releaseTx,
    ...(value.explorer === undefined ? {} : { explorer: value.explorer as string | null }),
    ...(value.slip === undefined ? {} : { slip: value.slip }),
  };
}

/** The verifier's verdict, whether the MCP server sends its JSON or a CLI-style last line. */
export function mcpVerdict(text: string): "VALID" | "INVALID" {
  const trimmed = text.trim();
  try {
    const body = JSON.parse(trimmed) as { valid?: unknown } | null;
    if (body && typeof body.valid === "boolean") return body.valid ? "VALID" : "INVALID";
  } catch {
    // not the verifier's JSON
  }
  const last = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  if (last === "INVALID") return "INVALID";
  if (last === "VALID" || last.startsWith("VALID ")) return "VALID";
  if (/\bINVALID\b/.test(trimmed)) return "INVALID";
  if (/\bVALID\b/.test(trimmed)) return "VALID";
  throw new Error("the MCP verify_slip answer carries no verdict");
}

function publicHub(ctx: FlowCtx): string {
  const configured = ctx.env.options.publicHub;
  check(configured, "no public hub configured");
  return configured.replace(/\/+$/, "");
}

function inside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`);
}

function cleanEnv(clean: CleanDir, key?: Hex): Record<string, string> {
  return {
    HOME: clean.home,
    npm_config_cache: join(clean.dir, "npm-cache"),
    ...(key === undefined ? {} : { CS_BUYER_KEY: key }),
  };
}

function logName(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function runPublished(
  ctx: FlowCtx,
  clean: CleanDir,
  label: string,
  args: string[],
  key?: Hex,
  timeoutMs = 240_000,
): Promise<CmdResult> {
  return runCmd(
    {
      name: `npx ${label}`,
      cmd: ["npx", "-y", `${CLI}@${VERSION}`, ...args],
      cwd: clean.dir,
      env: cleanEnv(clean, key),
      log: join(ctx.dir, `npx-${logName(label)}.log`),
      redact: (text) => ctx.env.secrets.redact(text),
    },
    timeoutMs,
  );
}

async function npmView(ctx: FlowCtx, clean: CleanDir, pkg: string): Promise<string | null> {
  const r = await runCmd(
    {
      name: `npm view ${pkg}`,
      cmd: ["npm", "view", `${pkg}@${VERSION}`, "version"],
      cwd: clean.dir,
      env: cleanEnv(clean),
      log: join(ctx.dir, `npm-view-${logName(pkg)}.log`),
      redact: (text) => ctx.env.secrets.redact(text),
    },
    120_000,
  );
  if (r.code !== 0) return null;
  return r.stdout.trim().split(/\s+/).at(-1) || null;
}

function toolText(result: McpToolResult, what: string): string {
  const first = result.content?.[0];
  const detail = first?.type === "text" && typeof first.text === "string" ? first.text : "";
  check(result.isError !== true, `${what} failed: ${detail.slice(0, 300)}`);
  check(first?.type === "text" && typeof first.text === "string", `${what} returned no text`);
  return first.text;
}

/** Read the release receipt and prove the named Arc escrow emitted Released for this slip. */
async function releasedOnArc(escrow: Address, tx: string, slipHash: string, label: string, jobId?: string): Promise<void> {
  const rcpt = await receipt(ARC, tx as Hex);
  equal(rcpt.status, "success", `${label} status (1)`);
  const events = escrowEvents({ ...ARC, escrow }, rcpt).released;
  equal(events.length, 1, `${label} Released events`);
  sameHex(events[0]?.slipHash, slipHash, `${label} Released.slipHash`);
  if (jobId !== undefined) sameHex(events[0]?.jobId, jobId, `${label} Released.jobId`);
}

export const npmPublished: Flow = {
  name: "npm-published",
  title: "The published npm packages from a clean directory",
  owner: "cs-truth",
  network: "arc",
  onDemand: "it installs the published packages from npm; run it with --flow npm-published",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  spends(env) {
    const w = wallets(env.secrets);
    return [{ wallet: w.arcBuyer(), amount: SPEND, floor: FLOOR }];
  },
  timeoutMs: 15 * 60_000,
  async run(ctx) {
    const clean = await ctx.step("a clean directory", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cs-npm-"));
      check(!inside(dir, ROOT), `the clean directory ${dir} is inside the repository`);
      const home = join(dir, "home");
      const state = join(dir, "state");
      mkdirSync(home, { recursive: true });
      mkdirSync(state, { recursive: true });
      const value: CleanDir = { dir, home, state };

      const cli = await npmView(ctx, value, CLI);
      check(cli, `${CLI}@${VERSION} is not on npm`);
      ctx.note(`published ${CLI} ${cli}`);
      const mcp = await npmView(ctx, value, MCP);
      if (mcp) ctx.note(`published ${MCP} ${mcp}`);
      ctx.note(`clean directory ${dir}`);
      return value;
    });

    await ctx.step("help answers", async () => {
      const help = await runPublished(ctx, clean, "help", ["--help"]);
      equal(help.code, 0, `--help exit code (stderr ${JSON.stringify(help.stderr.trim().slice(0, 300))})`);
      check(help.stdout.includes("countersign"), "--help names countersign");

      const buy = await runPublished(ctx, clean, "buy help", ["buy", "--help"]);
      equal(buy.code, 0, `buy --help exit code (stderr ${JSON.stringify(buy.stderr.trim().slice(0, 300))})`);
      check(buy.stdout.includes("buy"), "buy --help names buy");
    });

    const listing = await ctx.step("discover with the default hub", async () => {
      const discover = await runPublished(ctx, clean, "discover", ["discover", "--state", clean.state]);
      equal(discover.code, 0, `discover exit code (stderr ${JSON.stringify(discover.stderr.trim().slice(0, 300))})`);

      const base = publicHub(ctx);
      const res = await ctx.http("public offers", `${base}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: PublicListing[] }).offers ?? [];
      const live = offers.filter(
        (l) => l.online && l.status === "listed" && l.offer.rails.includes("escrow") && BigInt(l.offer.price) <= MAX_PRICE,
      );
      check(live.length > 0, `the public hub has no online Arc offer at or under 0.01 USDC (it lists ${offers.length})`);
      const found = live.find((l) => l.offer.title === "use-arc");
      check(found, `the public hub lists no online use-arc offer at or under 0.01 USDC (it lists ${live.length} live)`);
      sameHex(canonicalHash(found.offer), found.offerHash, "the offer hashes to its offerHash");

      const line = useArcDiscoverLine(discover.stdout, found.offerHash);
      ctx.note(`discover printed ${line.trim()}`);
      ctx.note(`bought ${found.offer.title} ${found.offerHash.slice(0, 10)} from seller ${found.offer.seller}`);
      return found;
    });

    const bought = await ctx.step("buy on Arc", async () => {
      const key = ctx.env.secrets.key("CS_BUYER_KEY");
      const seller = listing.offer.seller as Address;

      // The buyer CLI derives the envelope's agent address from the key, so this child gets it too.
      const envelope = await runPublished(
        ctx,
        clean,
        "envelope",
        ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", "--allow", seller.toLowerCase(), "--state", clean.state],
        key,
      );
      equal(envelope.code, 0, `envelope set exit code (stderr ${JSON.stringify(envelope.stderr.trim().slice(0, 300))})`);

      const buy = await runPublished(
        ctx,
        clean,
        "buy",
        ["buy", listing.offerHash, "--input", "{}", "--state", clean.state],
        key,
      );
      equal(buy.code, 0, `buy exit code (stderr ${JSON.stringify(buy.stderr.trim().slice(0, 300))})`);
      check(buy.stdout.includes("Released. Slip minted."), "buy prints Released. Slip minted.");

      const mine = readJournal(clean.state).filter((e) => e.offerHash?.toLowerCase() === listing.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,released", "journal kinds");
      const released = mine[2];
      check(released?.jobId, "journal carries the job");
      check(released.slipHash, "journal carries the slip hash");
      check(released.closeTx, "journal carries the release transaction");

      const base = publicHub(ctx);
      const rails = await ctx.http("public rails", `${base}/rails`);
      equal(rails.status, 200, "rails status");
      const declared = (rails.json as { rails?: Rail[] }).rails ?? [];
      const escrowRail = declared.find((r) => r.id === "escrow");
      check(escrowRail?.escrow, `the public hub names an escrow rail (rails: ${declared.map((r) => r.id).join(", ") || "none"})`);
      equal(escrowRail.network, `eip155:${ARC.chainId}`, "escrow rail network");
      const escrow = getAddress(escrowRail.escrow);
      check(sameAddress(escrow, ARC.escrow), `the hub's escrow ${escrow} is not the Arc escrow this suite reads`);
      ctx.note(`escrow ${escrow}`);

      await releasedOnArc(escrow, released.closeTx, released.slipHash, "release tx", released.jobId);
      ctx.tx("arc", "release (published CLI)", released.closeTx);
      return { slipHash: released.slipHash as Hex, releaseTx: released.closeTx as Hex, escrow };
    });

    await ctx.step("verify VALID", async () => {
      const slipPath = join(clean.state, "slips", `${bought.slipHash}.json`);
      check(existsSync(slipPath), `the buyer saved its slip at ${slipPath}`);
      const verify = await runPublished(ctx, clean, "verify", ["verify", slipPath, "--rpc", ARC.rpc]);
      equal(verify.code, 0, `verify exit code (stderr ${JSON.stringify(verify.stderr.trim().slice(0, 300))})`);
      const lines = verify.stdout.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
      equal(lines.at(-1), "VALID", `the verifier's last line (${lines.slice(-3).join(" | ")})`);
    });

    await ctx.step("the MCP server through the SDK client", async () => {
      const key = ctx.env.secrets.key("CS_BUYER_KEY");
      const sdkRoot = join(ROOT, "packages/mcp");
      const clientPath = Bun.resolveSync("@modelcontextprotocol/sdk/client/index.js", sdkRoot);
      const stdioPath = Bun.resolveSync("@modelcontextprotocol/sdk/client/stdio.js", sdkRoot);
      const { Client } = (await import(clientPath)) as { Client: McpClientConstructor };
      const { StdioClientTransport } = (await import(stdioPath)) as { StdioClientTransport: McpTransportConstructor };

      const logPath = join(ctx.dir, "mcp-server.log");
      writeFileSync(logPath, "");
      const transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", `${CLI}@${VERSION}`, "mcp", "--state", clean.state],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: clean.home,
          npm_config_cache: join(clean.dir, "npm-cache"),
          NO_COLOR: "1",
          CS_BUYER_KEY: key,
        },
        cwd: clean.dir,
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer | string) => {
        appendFileSync(logPath, ctx.env.secrets.redact(typeof chunk === "string" ? chunk : chunk.toString()));
      });

      const client = new Client({ name: "countersign-e2e", version: "0.0.0" });
      ctx.defer(() => client.close());
      await client.connect(transport);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      equal(names.join(","), TOOL_NAMES.join(","), "the MCP server lists its six tools");

      const search = await client.callTool({ name: "search_offers", arguments: { query: "use-arc" } });
      const rows = JSON.parse(toolText(search, "search_offers")) as Array<{ offerHash?: string }>;
      check(Array.isArray(rows), "search_offers answers a list");
      const found = rows.find((r) => typeof r.offerHash === "string" && r.offerHash.toLowerCase() === listing.offerHash.toLowerCase());
      check(found?.offerHash, `search_offers names ${listing.offerHash.slice(0, 10)} (it answered ${rows.length})`);

      const buy = await client.callTool({ name: "buy", arguments: { offerHash: found.offerHash, input: {} } });
      const reply = parseMcpBuy(buy.content ?? []);
      check(reply.output !== undefined, "the MCP buy returns the seller's output");
      await releasedOnArc(bought.escrow, reply.releaseTx, reply.slipHash, "MCP buy release tx");
      ctx.tx("arc", "release (MCP buy)", reply.releaseTx);

      const verify = await client.callTool({ name: "verify_slip", arguments: { slipHash: reply.slipHash } });
      equal(mcpVerdict(toolText(verify, "verify_slip")), "VALID", "verify_slip says VALID");
    });
  },
};
