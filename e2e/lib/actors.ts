/**
 * The parties of a flow, each run as its own process the way a user runs it: the hub, a seller's
 * runner, the buyer CLI and the standalone verifier. Each process gets only its own key.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalHash, type Offer } from "@countersign/core";
import { KNOWN_RAILS, type KnownRail } from "@countersign/buyer";
import { ARC } from "./chains.ts";
import { check, equal, sameHex, type FlowCtx } from "./flow.ts";
import { freePort } from "./http.ts";
import { runCmd, spawnProc, type CmdResult, type Proc } from "./procs.ts";

export interface CatalogueItem {
  skill: string;
  upstream: { url: string; licence: string };
}

export const USE_ARC: CatalogueItem = {
  skill: "examples/catalogue/circle/use-arc/SKILL.md",
  upstream: {
    url: "https://github.com/circlefin/skills/tree/1f23655cbc360f7783e6881e026dbd4568c40f1d/plugins/circle/skills/use-arc",
    licence: "Apache-2.0",
  },
};

export const WHITECHAIN_DEV: CatalogueItem = {
  skill: "examples/catalogue/whitechain/whitechain-dev/SKILL.md",
  upstream: {
    url: "https://github.com/whitechain-labs/skills/tree/76d88a68350a23a22efb62110aa1874428a36c11/whitechain-dev",
    licence: "none published; reproduced verbatim",
  },
};

export interface RailDeclarationLike {
  id: string;
  network: string;
  kind: string;
  escrow?: string;
}

export interface HubHandle {
  url: string;
  port: number;
  proc: Proc;
  rails: RailDeclarationLike[];
}

export interface HubOptions {
  /** Escrow rail on Arc, gas from the suite's own submitter wallet. */
  arc?: boolean;
  /** Hedera rail through the x402 facilitator; the hub holds no Hedera key. */
  hedera?: boolean;
  /** Extra environment, e.g. a relay URL for the Whitechain rail. */
  env?: Record<string, string>;
  label?: string;
}

/** A fresh hub: its own port, its own database, stopped when the flow ends. */
export async function startHub(ctx: FlowCtx, opts: HubOptions): Promise<HubHandle> {
  const port = freePort();
  const url = `http://127.0.0.1:${port}`;
  const label = opts.label ?? "hub";
  const env: Record<string, string> = {
    PORT: String(port),
    HUB_DB: join(ctx.dir, `${label}.sqlite`),
    HUB_PUBLIC_URL: url,
    ...opts.env,
  };
  if (opts.arc) {
    env.ARC_ESCROW = ARC.escrow;
    env.ARC_RPC_URL = ARC.rpc;
    env.CS_RELAYER_KEY = ctx.env.secrets.key("E2E_ARC_SUBMITTER_KEY");
    if (ARC.escrowVersion === 2) env.ARC_ESCROW_VERSION = "2";
  }
  if (opts.hedera) env.HEDERA_RAIL = "1";
  const proc = spawnProc({
    name: label,
    cmd: ["bun", "apps/hub/src/index.ts"],
    env,
    log: join(ctx.dir, `${label}.log`),
    redact: (s) => ctx.env.secrets.redact(s),
  });
  ctx.defer(() => proc.stop());
  await proc.waitFor(/\[hub\] listening on /, 30_000);
  const health = await ctx.http(`${label} healthz`, `${url}/healthz`);
  equal(health.status, 200, "healthz status");
  const body = health.json as { ok?: boolean; rails?: RailDeclarationLike[] };
  equal(body.ok, true, "healthz ok");
  const rails = body.rails ?? [];
  if (opts.arc) {
    const escrow = rails.find((r) => r.id === "escrow");
    check(escrow, `hub declares the escrow rail (rails: ${rails.map((r) => r.id).join(", ") || "none"})`);
    sameHex(escrow.escrow, ARC.escrow, "escrow rail address");
    equal(escrow.network, `eip155:${ARC.chainId}`, "escrow rail network");
  }
  if (opts.hedera) check(rails.some((r) => r.id === "hedera"), `hub declares the hedera rail (rails: ${rails.map((r) => r.id).join(", ")})`);
  return { url, port, proc, rails };
}

export interface SellerOptions {
  item: CatalogueItem;
  /** Atomic units of the 6-decimal stablecoin. */
  price: bigint;
  deadline: number;
  rails: string[];
  /** Payee per rail where it is not the seller's address, e.g. { hedera: "0.0.1234" }. */
  payTo?: Record<string, string>;
  /** Env name of the seller key. */
  key: string;
  label?: string;
  /** The runner's state directory. Each flow uses its own unless a flow passes one to share. */
  state?: string;
}

export interface SellerHandle {
  offerHash: Hex;
  offer: Offer;
  seller: Address;
  proc: Proc;
}

/** The runner CLI serving one catalogue item, as a seller runs it. */
export async function startSkillSeller(ctx: FlowCtx, hub: HubHandle, o: SellerOptions): Promise<SellerHandle> {
  const label = o.label ?? "runner";
  const seller = ctx.env.secrets.account(o.key).address;
  const proc = spawnProc({
    name: label,
    cmd: [
      "bun", "packages/runner/src/cli.ts", "serve",
      "--hub", hub.url,
      "--skill", o.item.skill,
      "--price", o.price.toString(),
      "--deadline", String(o.deadline),
      "--rails", o.rails.join(","),
      "--upstream-url", o.item.upstream.url,
      "--licence", o.item.upstream.licence,
      ...Object.entries(o.payTo ?? {}).flatMap(([rail, id]) => ["--pay-to", `${rail}=${id}`]),
      ...(ARC.escrowVersion === 2 ? ["--known-escrow", `5042002=${ARC.escrow}`] : []),
      // Never the shared default under $HOME: other runners on the machine write there too.
      "--state", o.state ?? join(ctx.dir, `${label}-state`),
    ],
    env: { CS_SELLER_KEY: ctx.env.secrets.key(o.key) },
    log: join(ctx.dir, `${label}.log`),
    redact: (s) => ctx.env.secrets.redact(s),
  });
  ctx.defer(() => proc.stop());
  const published = await proc.waitFor(/published (0x[0-9a-fA-F]{64})/, 30_000);
  await proc.waitFor(/runner ready/, 30_000);
  const offerHash = published[1] as Hex;

  const res = await ctx.http("offer listing", `${hub.url}/offers/${offerHash}`);
  equal(res.status, 200, "offer listing status");
  const listing = res.json as { offerHash: Hex; offer: Offer; online: boolean; status: string };
  sameHex(canonicalHash(listing.offer), offerHash, "the listed offer hashes to its offerHash");
  equal(listing.status, "listed", "offer status");
  equal(listing.online, true, "offer online");
  sameHex(listing.offer.seller, seller, "offer seller");
  equal(listing.offer.price, o.price.toString(), "offer price");
  equal(listing.offer.deadline, o.deadline, "offer deadline");
  for (const [rail, id] of Object.entries(o.payTo ?? {})) {
    equal((listing.offer.payTo as Record<string, string> | undefined)?.[rail], id, `offer payee on ${rail}`);
  }
  return { offerHash, offer: listing.offer, seller, proc };
}

/**
 * The Arc entry of the buyer's own rail list, pinned to this suite's escrow as v2. The buyer
 * never takes the version from the hub: it reads this pin through state.loadRails().
 */
export function arcV2Rail(): KnownRail {
  const arc = KNOWN_RAILS.find((rail) => rail.chainId === ARC.chainId);
  if (!arc) throw new Error("the buyer has no Arc rail to pin");
  return { ...arc, escrow: ARC.escrow, version: 2 };
}

/** Pin Arc v2 in a buyer state directory before the buyer's first call. */
export function pinArcV2(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "rails.json"), `${JSON.stringify([arcV2Rail()], null, 2)}\n`);
}

/** The address the suite's hub signs Arc transactions with; the key never leaves the signer. */
export function submitterAddress(ctx: FlowCtx): Address {
  return privateKeyToAccount(ctx.env.secrets.key("E2E_ARC_SUBMITTER_KEY")).address;
}

/** One buyer CLI command with the buyer key in its environment and nothing else. */
export function buyerCli(
  ctx: FlowCtx,
  label: string,
  hubUrl: string,
  state: string,
  keyName: string,
  args: string[],
  timeoutMs = 150_000,
): Promise<CmdResult> {
  if (ARC.escrowVersion === 2) pinArcV2(state);
  return runCmd(
    {
      name: `buyer ${label}`,
      cmd: ["bun", "packages/buyer/src/cli.ts", ...args, "--hub", hubUrl, "--state", state],
      env: { CS_BUYER_KEY: ctx.env.secrets.key(keyName) },
      log: join(ctx.dir, `buyer-${label}.log`),
      redact: (s) => ctx.env.secrets.redact(s),
    },
    timeoutMs,
  );
}

export interface JournalLine {
  at: number;
  kind: string;
  offerHash?: string;
  seller?: string;
  amount?: string;
  rail?: string;
  jobId?: Hex;
  slipHash?: Hex;
  closeTx?: string;
  reason?: string;
}

export function readJournal(state: string): JournalLine[] {
  const path = join(state, "journal.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as JournalLine);
}

export interface Verdict {
  code: number;
  lines: string[];
  verdict: string;
  /** check name -> "ok" | "FAIL" */
  checks: Map<string, string>;
  skipped: string[];
}

/** The standalone verifier: the slip file and a public RPC, nothing else. */
/** Run the standalone verifier. With `mirror`, it proves a held Hedera payment on that mirror node. */
export async function verifyCli(ctx: FlowCtx, label: string, slipPath: string, rpc: string, opts: { mirror?: string } = {}): Promise<Verdict> {
  const r = await runCmd(
    {
      name: `verify ${label}`,
      cmd: ["bun", "packages/verify/src/cli.ts", slipPath, "--rpc", rpc, ...(opts.mirror ? ["--mirror", opts.mirror] : [])],
      log: join(ctx.dir, `verify-${label}.log`),
      redact: (s) => ctx.env.secrets.redact(s),
    },
    90_000,
  );
  const lines = r.stdout.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const checks = new Map<string, string>();
  const skipped: string[] = [];
  for (const line of lines) {
    const m = /^(ok|FAIL)\s+(\S+)/.exec(line);
    if (m) checks.set(m[2] as string, m[1] as string);
    if (line.startsWith("skip")) skipped.push(line);
  }
  return { code: r.code, lines, verdict: lines.at(-1) ?? "", checks, skipped };
}
