/**
 * The seller CLI. The key comes only from CS_SELLER_KEY; it is never printed
 * and never accepted as an argument.
 *
 *   bun packages/runner/src/cli.ts publish --hub <url> --skill <path> --price <atomic> ...
 *   bun packages/runner/src/cli.ts serve --hub <url> --skill <path> [--skill <path> ...]
 *     [--known-escrow <chainId>=<address> ...] [--rpc <chainId>=<url> ...] ...
 *   bun packages/runner/src/cli.ts bond deposit|withdraw|show ... --escrow <address>
 *
 * `serve` checks every escrow job on chain before it runs: KNOWN_ESCROWS plus any extra pins,
 * over Arc's default RPC, ARC_RPC_URL or WC_RPC_URL, plus any --rpc overrides.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseAtomic, RAIL_IDS, type Offer, type RailId } from "@countersign/core";
import { KNOWN_ESCROWS } from "@countersign/verify";
import { isAddress } from "viem";
import type { Address, Hex, RunnerAccount } from "./account.ts";
import { bondFromEnv } from "./bond.ts";
import { startRunner, type ServedOffer } from "./daemon.ts";
import {
  ARC_RPC_URL,
  ARC_TESTNET,
  WHITECHAIN_TESTNET,
  type FundingConfig,
  type PinnedEscrow,
} from "./funding.ts";
import { publishOffer, type PublishedOffer } from "./publish.ts";
import { readSkill, skillOffer, type Skill } from "./skill.ts";

const DEFAULT_DEADLINE = 120;

interface RpcEndpoint {
  chainId: number;
  url: string;
}

export interface Options {
  hub: string;
  skills: string[];
  price: string;
  deadline: number;
  rails: RailId[];
  payTo?: Partial<Record<RailId, string>>;
  state?: string;
  upstream?: { url: string; licence: string };
  /** Extra escrow pins on top of KNOWN_ESCROWS. */
  knownEscrows?: PinnedEscrow[];
  /** Extra RPC endpoints on top of the environment and Arc's default. */
  rpcs?: RpcEndpoint[];
}

export interface FundingEnv {
  [key: string]: string | undefined;
  ARC_RPC_URL?: string | undefined;
  WC_RPC_URL?: string | undefined;
}

/** The CLI's funding check: KNOWN_ESCROWS plus pins, and the per-chain RPCs. */
export function fundingFor(options: Options, env: FundingEnv = process.env): FundingConfig {
  // Both pinned chains get a default, so the check never refuses a pinned escrow for want of an RPC.
  // Whitechain's is the one the rail and relay use (packages/rail/src/whitechain WHITECHAIN_RPC_URL).
  const rpc: Record<number, string> = {
    [ARC_TESTNET]: env.ARC_RPC_URL || ARC_RPC_URL,
    [WHITECHAIN_TESTNET]: env.WC_RPC_URL || "https://rpc.ankr.com/whitechain_testnet",
  };
  for (const entry of options.rpcs ?? []) rpc[entry.chainId] = entry.url;

  return {
    known: [
      ...KNOWN_ESCROWS.map((entry) => ({ chainId: entry.chainId, escrow: entry.escrow })),
      ...(options.knownEscrows ?? []),
    ],
    rpc,
  };
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "publish") {
    await publishCommand(parseOptions(args));
    return;
  }
  if (command === "serve") {
    await serveCommand(parseOptions(args));
    return;
  }
  if (command === "bond") {
    await bondFromEnv(args);
    return;
  }
  throw new Error("Usage: cli.ts <publish|serve|bond> ...");
}

async function publishCommand(options: Options): Promise<void> {
  const account = await sellerAccount();
  const path = options.skills[0];
  if (path === undefined) throw new Error("--skill is required.");
  const skill = await readSkill(path);
  const offer = makeOffer(account.address, skill, options);
  const { offerHash } = await publishWithState(options, account, offer, skill);
  console.log(offerHash);
}

function publishWithState(
  options: Options,
  account: RunnerAccount,
  offer: Offer,
  skill: Skill,
): Promise<PublishedOffer> {
  return publishOffer(options.hub, account, offer, {
    ...(options.state !== undefined ? { stateDir: options.state } : {}),
    skillSha256: skill.sha256,
  });
}

export interface PreparedServe {
  served: ServedOffer[];
  hashes: Hex[];
}

/** Publish every skill and return the stable offers a runner should serve. */
export async function prepareServed(
  options: Options,
  account: RunnerAccount,
): Promise<PreparedServe> {
  const served: ServedOffer[] = [];
  const hashes: Hex[] = [];

  for (const path of options.skills) {
    const skill = await readSkill(path);
    const offer = makeOffer(account.address, skill, options);
    const published = await publishWithState(options, account, offer, skill);
    console.log(`published ${published.offerHash} ${published.offer.title}`);
    served.push({ offer: published.offer, spec: { adapter: "skill", skillPath: path } });
    hashes.push(published.offerHash);
  }

  return { served, hashes };
}

async function serveCommand(options: Options): Promise<void> {
  const account = await sellerAccount();
  const { served } = await prepareServed(options, account);

  const handle = startRunner({
    hubUrl: options.hub,
    account,
    served,
    funding: fundingFor(options),
    onJob: (event) => {
      const jobId = event.jobId.length > 10 ? `${event.jobId.slice(0, 10)}…` : event.jobId;
      console.log(`${jobId} ${event.title} ${event.ok ? "ok" : event.reason ?? "refused"}`);
    },
  });

  let resolveStop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const shutdown = (): void => {
    handle.stop();
    resolveStop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const first = await Promise.race([
    handle.ready.then(() => "ready" as const),
    stopped.then(() => "stopped" as const),
  ]);
  if (first === "ready") console.log("runner ready");
  await stopped;
}

function makeOffer(seller: Address, skill: Skill, options: Options): Offer {
  return skillOffer({
    seller,
    skill,
    price: options.price,
    deadline: options.deadline,
    rails: options.rails,
    payTo: options.payTo,
    upstream: options.upstream,
    now: Math.floor(Date.now() / 1000),
  });
}

interface AccountsModule {
  privateKeyToAccount(key: Hex): RunnerAccount;
}

async function sellerAccount(): Promise<RunnerAccount> {
  const key = process.env.CS_SELLER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("CS_SELLER_KEY must hold a 0x-prefixed 32-byte hex key.");
  }
  const module = await loadAccounts();
  return module.privateKeyToAccount(key as Hex);
}

/** Resolve viem through @countersign/core, which declares it as a dependency. */
async function loadAccounts(): Promise<AccountsModule> {
  const require = createRequire(import.meta.resolve("@countersign/core"));
  const path = require.resolve("viem/accounts");
  return (await import(pathToFileURL(path).href)) as AccountsModule;
}

export function parseOptions(args: string[]): Options {
  const skills: string[] = [];
  let hub: string | undefined;
  let price: string | undefined;
  let deadline = DEFAULT_DEADLINE;
  let rails: RailId[] = ["escrow"];
  let state: string | undefined;
  let upstreamUrl: string | undefined;
  let licence: string | undefined;
  const payTo: Partial<Record<RailId, string>> = {};
  const knownEscrows: PinnedEscrow[] = [];
  const rpcs: RpcEndpoint[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i] ?? "";
    const value = (): string => {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      i += 1;
      return next;
    };
    switch (flag) {
      case "--hub":
        hub = value();
        break;
      case "--skill":
        skills.push(value());
        break;
      case "--price":
        price = value();
        break;
      case "--deadline": {
        const parsed = Number(value());
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new Error("--deadline must be a positive integer.");
        }
        deadline = parsed;
        break;
      }
      case "--rails":
        rails = parseRails(value());
        break;
      case "--pay-to": {
        const pair = value();
        const equals = pair.indexOf("=");
        if (equals <= 0 || equals === pair.length - 1) {
          throw new Error("--pay-to needs <rail>=<id>.");
        }
        const rail = pair.slice(0, equals).trim();
        const id = pair.slice(equals + 1).trim();
        if (!RAIL_IDS.includes(rail as RailId)) throw new Error(`Unknown rail ${rail}.`);
        if (id === "") throw new Error("--pay-to needs a payee id.");
        payTo[rail as RailId] = id;
        break;
      }
      case "--known-escrow": {
        const pair = value();
        const equals = pair.indexOf("=");
        if (equals <= 0 || equals === pair.length - 1) {
          throw new Error("--known-escrow needs <chainId>=<address>.");
        }
        const chainId = Number(pair.slice(0, equals));
        const escrow = pair.slice(equals + 1);
        if (!Number.isSafeInteger(chainId) || chainId <= 0) {
          throw new Error("--known-escrow needs a positive chain id.");
        }
        if (!isAddress(escrow)) throw new Error("--known-escrow needs an address.");
        knownEscrows.push({ chainId, escrow });
        break;
      }
      case "--rpc": {
        const pair = value();
        const equals = pair.indexOf("=");
        if (equals <= 0 || equals === pair.length - 1) {
          throw new Error("--rpc needs <chainId>=<url>.");
        }
        const chainId = Number(pair.slice(0, equals));
        if (!Number.isSafeInteger(chainId) || chainId <= 0) {
          throw new Error("--rpc needs a positive chain id.");
        }
        const url = pair.slice(equals + 1).trim();
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("--rpc needs a URL.");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("--rpc needs an http or https URL.");
        }
        rpcs.push({ chainId, url });
        break;
      }
      case "--state":
        state = value();
        break;
      case "--upstream-url":
        upstreamUrl = value();
        break;
      case "--licence":
        licence = value();
        break;
      default:
        throw new Error(`Unknown argument ${flag}.`);
    }
  }

  if (hub === undefined) throw new Error("--hub is required.");
  if (skills.length === 0) throw new Error("--skill is required.");
  if (price === undefined) throw new Error("--price is required.");
  try {
    if (parseAtomic(price) === 0n) throw new Error("zero");
  } catch {
    throw new Error("--price must be a positive atomic amount.");
  }
  if ((upstreamUrl === undefined) !== (licence === undefined)) {
    throw new Error("--upstream-url and --licence go together.");
  }

  const options: Options = { hub, skills, price, deadline, rails };
  if (Object.keys(payTo).length > 0) options.payTo = payTo;
  if (state !== undefined) options.state = state;
  if (upstreamUrl !== undefined && licence !== undefined) {
    options.upstream = { url: upstreamUrl, licence };
  }
  if (knownEscrows.length > 0) options.knownEscrows = knownEscrows;
  if (rpcs.length > 0) options.rpcs = rpcs;
  return options;
}

function parseRails(raw: string): RailId[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) throw new Error("--rails needs at least one rail.");
  const rails = values.map((value) => {
    if (!RAIL_IDS.includes(value as RailId)) throw new Error(`Unknown rail ${value}.`);
    return value as RailId;
  });
  return [...new Set(rails)];
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
