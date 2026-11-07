import type { Context, Hono } from "hono";
import {
  buildExactTransfer,
  USDC_TESTNET,
  getTransaction,
  tokenBalance,
  validatePrivyTransfer,
} from "@countersign/rail/hedera";
import { paidCall, type CallDeps } from "./call.ts";
import {
  capFor,
  expectedHederaTransfer,
  MAX_HEDERA_VALIDITY_SECONDS,
  provisionHederaAccount,
  signHederaPayment,
  type CliHederaDeps,
  type HederaTermsRefusal,
} from "./cli-auth/routes.ts";
import type { CliAuthStore } from "./cli-auth/store.ts";
import { HARD_CAP } from "./cli-auth/policy.ts";
import {
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type CallResult,
  type EnsResolve,
  type PaymentPayload,
  type Rail,
} from "./deps.ts";
import { personFrom, type Person, type PrivyVerifier } from "./privy.ts";
import type { HubRouter } from "./route.ts";
import type { RunnerLink } from "./runners.ts";
import type { Store } from "./store.ts";
import type { WalletApi } from "./wallets/privy-wallets.ts";

/** The mirror reads a console purchase makes. Tests pass a fake; the hub reads the live testnet mirror. */
export interface MeHederaMirror {
  balance(accountId: string, tokenId: string): Promise<bigint | null>;
  consensusTime(transactionId: string): Promise<string | null>;
}

export interface MeHederaDeps {
  cliStore: CliAuthStore;
  hubStore: Store;
  wallets: WalletApi;
  privy?: PrivyVerifier;
  consoleUrl: string;
  now: () => number;
  hedera: CliHederaDeps;
  rails: Rail[];
  runners: RunnerLink;
  router: HubRouter;
  publicUrl: string;
  jobTimeoutMs?: number;
  ens?: EnsResolve;
  mirror?: MeHederaMirror;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const SETTLEMENT_READ_ATTEMPTS = 10;
const SETTLEMENT_READ_DELAY_MS = 1_000;
const NODE_COUNT = 5;

export function registerMeHedera(app: Hono, deps: MeHederaDeps): void {
  const running = new Set<string>();
  app.get("/me/hedera", (c) => readAccount(c, deps));
  app.post("/me/hedera/buy", (c) => buy(c, deps, running));
}

async function readAccount(c: Context, deps: MeHederaDeps): Promise<Response> {
  const person = await signedIn(c, deps);
  if (person instanceof Response) return person;

  const provisioned = await provisionHederaAccount(
    { store: deps.cliStore, wallets: deps.wallets, now: deps.now, hedera: deps.hedera },
    person.userId,
  );
  if (!provisioned.ok) return fail(provisioned.status, provisioned.code, provisioned.message);
  return json({
    accountId: provisioned.accountId,
    usdc: await usdcBalance(deps, provisioned.accountId),
  });
}

async function buy(c: Context, deps: MeHederaDeps, running: Set<string>): Promise<Response> {
  const person = await signedIn(c, deps);
  if (person instanceof Response) return person;

  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== deps.consoleUrl) {
    return fail(403, "bad-origin", "Refused. This request came from another origin.");
  }

  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") {
    return fail(413, "too-large", "Refused. The request body is too large.");
  }
  if (parsed.kind !== "ok" || !isRecord(parsed.value)) return badRequest();
  const keys = Object.keys(parsed.value).sort();
  if (keys.length !== 2 || keys[0] !== "input" || keys[1] !== "offerHash") return badRequest();
  const offerHash = parsed.value.offerHash;
  if (typeof offerHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(offerHash)) {
    return badRequest();
  }
  const input = parsed.value.input;

  if (running.has(person.userId)) {
    return fail(409, "purchase-running", "A purchase is already running.");
  }
  running.add(person.userId);
  try {
    return await buyLocked(deps, person, offerHash.toLowerCase(), input);
  } finally {
    running.delete(person.userId);
  }
}

async function buyLocked(
  deps: MeHederaDeps,
  person: Person,
  offerHash: string,
  input: unknown,
): Promise<Response> {
  const row = deps.cliStore.getHedera(person.userId);
  if (
    row?.state !== "ready" ||
    row.accountId === null ||
    row.publicKey === null ||
    row.walletId === null ||
    row.evmAddress === null
  ) {
    return fail(
      409,
      "no-hedera-account",
      "Open the Sign in menu to create your Hedera account first.",
    );
  }

  const terms = expectedHederaTransfer(
    deps.hubStore,
    deps.hedera.terms,
    offerHash,
    row.accountId,
    capForPerson(deps, person.wallets),
  );
  if (!terms.ok) return termsRefused(terms.reason);

  const built = buildExactTransfer({
    from: row.accountId,
    payTo: terms.expected.payTo,
    asset: terms.expected.asset,
    amount: terms.expected.amount,
    feePayer: terms.expected.feePayer,
    offerHash: terms.hash,
    validSeconds: MAX_HEDERA_VALIDITY_SECONDS,
    node: randomNode(),
  });
  const verdict = validatePrivyTransfer(built, terms.expected, deps.now());
  if (!verdict.ok) return notAllowed(verdict.reason);

  let signed: string;
  try {
    signed = await signHederaPayment(
      deps.wallets,
      { walletId: row.walletId, publicKey: row.publicKey },
      verdict.tx,
    );
  } catch {
    return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
  }
  const signedAt = deps.now();

  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: terms.accepted,
    payload: { transaction: signed },
  };
  const headers = new Headers({ [PAYMENT_SIGNATURE_HEADER]: toBase64Json(payment) });
  const outcome = await paidCall(callDeps(deps), offerHash, headers, { input });
  if (outcome.status !== 200) return json(outcome.body, outcome.status);

  const result = outcome.body as Partial<CallResult> | null;
  const slip = result?.slip;
  if (slip === undefined) {
    return fail(502, "internal", "Refused. The hub could not complete the call.");
  }
  const returnedAt = deps.now();
  const settledAt = await settlementTime(
    deps,
    slip.settlement.transaction,
    returnedAt,
  );
  const url = slip.settlement.url ?? "";
  return json({
    steps: [
      { title: "Payment signed by your Hedera wallet", at: iso(signedAt) },
      { title: "Seller delivered", at: iso(slip.body.deliveredAt) },
      { title: "Output checked before any money moved", at: iso(slip.body.deliveredAt) },
      { title: "Settled on Hedera", at: settledAt, url },
      { title: "Slip minted", at: iso(returnedAt), url: `/verify?slip=${slip.hash}` },
    ],
    slipHash: slip.hash,
    hashscanUrl: url,
    output: result?.output,
  });
}

function callDeps(deps: MeHederaDeps): CallDeps {
  const call: CallDeps = {
    store: deps.hubStore,
    rails: deps.rails,
    runners: deps.runners,
    router: deps.router,
    now: deps.now,
    publicUrl: deps.publicUrl,
  };
  if (deps.jobTimeoutMs !== undefined) call.jobTimeoutMs = deps.jobTimeoutMs;
  if (deps.ens !== undefined) call.ens = deps.ens;
  if (deps.privy !== undefined) call.privy = deps.privy;
  return call;
}

function capForPerson(deps: MeHederaDeps, wallets: string[]): bigint | null {
  let cap: bigint | null = null;
  for (const wallet of wallets) {
    const value = capFor(deps.hubStore, deps.now, wallet);
    if (value === null) return null;
    if (cap === null || value < cap) cap = value;
  }
  return cap ?? HARD_CAP;
}

async function signedIn(c: Context, deps: MeHederaDeps): Promise<Person | Response> {
  const check = await personFrom(c.req.raw.headers, deps.privy);
  if (check.kind === "refused") return fail(check.status, check.code, check.message);
  if (check.kind === "none") {
    return fail(401, "bad-session", "Refused. Sign in to use your Hedera wallet. Nothing was charged.");
  }
  return check.person;
}

async function usdcBalance(deps: MeHederaDeps, accountId: string): Promise<string> {
  try {
    const atomic = await (deps.mirror ?? realMirror()).balance(accountId, USDC_TESTNET);
    return formatUsdc(atomic ?? 0n);
  } catch {
    return "0.00";
  }
}

function realMirror(): MeHederaMirror {
  return {
    balance: (accountId, tokenId) => tokenBalance(accountId, tokenId),
    consensusTime: async (transactionId) =>
      (await getTransaction(transactionId))?.consensusTimestamp ?? null,
  };
}

async function settlementTime(
  deps: MeHederaDeps,
  transactionId: string,
  fallbackSeconds: number,
): Promise<string> {
  const mirror = deps.mirror ?? realMirror();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < SETTLEMENT_READ_ATTEMPTS; attempt += 1) {
    try {
      const timestamp = await mirror.consensusTime(transactionId);
      if (timestamp !== null) {
        const seconds = Number(timestamp.split(".")[0]);
        if (Number.isSafeInteger(seconds)) return iso(seconds);
      }
    } catch {
      // A mirror that does not answer is one that has not seen the transaction yet.
    }
    if (attempt + 1 < SETTLEMENT_READ_ATTEMPTS) await sleep(SETTLEMENT_READ_DELAY_MS);
  }
  return iso(fallbackSeconds);
}

function formatUsdc(atomic: bigint): string {
  const cents = atomic / 10_000n;
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function randomNode(): string {
  return `0.0.${3 + Math.floor(Math.random() * NODE_COUNT)}`;
}

function termsRefused(reason: HederaTermsRefusal): Response {
  if (reason === "unknown-offer") return fail(404, "unknown-offer", "Refused. That offer is not listed.");
  if (reason === "envelope-closed") {
    return fail(403, "envelope-closed", "Refused. The envelope is closed.");
  }
  if (reason === "hedera-unavailable") {
    return fail(403, "hedera-unavailable", "Refused. The Hedera rail cannot answer right now.");
  }
  return fail(403, "hedera-not-offered", "Refused. This offer does not take the Hedera rail.");
}

function notAllowed(reason: string): Response {
  return json(
    { code: "not-allowed", message: "Refused. The hub will not sign that.", reason },
    403,
  );
}

type LimitedJson = { kind: "ok"; value: unknown } | { kind: "too-large" } | { kind: "malformed" };

async function readJsonLimited(c: Context): Promise<LimitedJson> {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return { kind: "malformed" };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { kind: "too-large" };
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "malformed" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}

function badRequest(): Response {
  return fail(400, "bad-request", "Refused. The request is malformed.");
}
