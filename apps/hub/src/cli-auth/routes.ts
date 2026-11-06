import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { personFrom, type PrivyVerifier } from "../privy.ts";
import type { Store } from "../store.ts";
import {
  WalletApiError,
  type TypedDataInput,
  type WalletApi,
} from "../wallets/privy-wallets.ts";
import { checkMessage, checkTypedData, HARD_CAP, type KnownEscrow } from "./policy.ts";
import type { CliAuthStore, CliSessionRecord } from "./store.ts";

export interface CliAuthDeps {
  store: CliAuthStore;
  wallets: WalletApi;
  privy?: PrivyVerifier;
  hubStore: Store;
  escrows: () => KnownEscrow[];
  consoleUrl: string;
  now: () => number;
}

const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_TTL = 600;
const SESSION_TTL = 604_800;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

export function registerCliAuth(app: Hono, deps: CliAuthDeps): void {
  app.post("/cli/login/start", (c) => startLogin(c, deps));
  app.post("/cli/login/approve", (c) => approveLogin(c, deps));
  app.post("/cli/login/poll", (c) => pollLogin(c, deps));
  app.get("/cli/session", (c) => readSession(c, deps));
  app.post("/cli/logout", (c) => logout(c, deps));
  app.post("/cli/sign", (c) => sign(c, deps));
}

function startLogin(c: Context, deps: CliAuthDeps): Response {
  const at = deps.now();
  const expiresAt = at + LOGIN_TTL;
  const code = newCode();
  const deviceSecret = `csd_${randomBytes(32).toString("hex")}`;
  deps.store.putLogin(code, hash(deviceSecret), at, expiresAt);
  return json({
    code,
    deviceSecret,
    verifyUrl: `${deps.consoleUrl}/#/cli-login?code=${code}`,
    interval: 3,
    expiresAt,
  });
}

async function approveLogin(c: Context, deps: CliAuthDeps): Promise<Response> {
  const signIn = await personFrom(c.req.raw.headers, deps.privy);
  if (signIn.kind === "refused") return fail(signIn.status, signIn.code, signIn.message);
  if (signIn.kind === "none") {
    return fail(401, "sign-in-required", "Refused. Sign in to approve this device.");
  }

  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return tooLarge();
  if (parsed.kind === "malformed") return badRequest();
  if (!isRecord(parsed.value) || typeof parsed.value.code !== "string") return badRequest();

  const code = parsed.value.code;
  const now = deps.now();
  const login = deps.store.getLoginByCode(code);
  if (login === null || login.consumed || login.expiresAt <= now) {
    return fail(404, "unknown-code", "Refused. That code is not valid.");
  }

  let wallet = deps.store.getWallet(signIn.person.userId);
  if (wallet === null) {
    try {
      const externalId = `cs_${hash(signIn.person.userId).slice(0, 40)}`;
      const created = await deps.wallets.createWallet(externalId);
      deps.store.putWallet(
        signIn.person.userId,
        created.id,
        created.address.toLowerCase(),
        now,
      );
      wallet = deps.store.getWallet(signIn.person.userId);
    } catch (error) {
      if (error instanceof WalletApiError) {
        return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
      }
      return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
    }
  }
  if (wallet === null) return fail(500, "internal", "Refused. The wallet is not known.");

  deps.store.approveLogin(code, signIn.person.userId);
  return json({ code, address: wallet.address });
}

async function pollLogin(c: Context, deps: CliAuthDeps): Promise<Response> {
  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return tooLarge();
  if (parsed.kind === "malformed") return badRequest();
  if (!isRecord(parsed.value) || typeof parsed.value.deviceSecret !== "string") return badRequest();

  const login = deps.store.getLoginByDevice(hash(parsed.value.deviceSecret));
  if (login === null) return fail(404, "unknown-device", "Refused. That device is not known.");

  const now = deps.now();
  if (login.expiresAt <= now) return fail(410, "expired", "Refused. That login has expired.");
  if (login.consumed) return fail(410, "used", "Refused. That login was already used.");
  if (login.userId === null) return json({ status: "pending" });

  const wallet = deps.store.getWallet(login.userId);
  if (wallet === null) return fail(500, "internal", "Refused. The wallet is not known.");

  deps.store.consumeLogin(login.code);
  const token = `css_${randomBytes(32).toString("hex")}`;
  const expiresAt = now + SESSION_TTL;
  deps.store.putSession({
    tokenHash: hash(token),
    userId: login.userId,
    walletId: wallet.walletId,
    address: wallet.address,
    createdAt: now,
    expiresAt,
  });
  return json({ status: "approved", sessionToken: token, address: wallet.address, expiresAt });
}

function readSession(c: Context, deps: CliAuthDeps): Response {
  const session = activeSession(c, deps);
  if (session === null) return notSignedIn();
  return json({ address: session.address, expiresAt: session.expiresAt });
}

function logout(c: Context, deps: CliAuthDeps): Response {
  const session = activeSession(c, deps);
  if (session === null) return notSignedIn();
  deps.store.revokeSession(session.tokenHash, deps.now());
  return json({ revoked: true });
}

async function sign(c: Context, deps: CliAuthDeps): Promise<Response> {
  const session = activeSession(c, deps);
  if (session === null) return notSignedIn();

  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return tooLarge();
  if (parsed.kind === "malformed") return badRequest();
  if (!isRecord(parsed.value)) return badRequest();

  if (parsed.value.kind === "typed-data") {
    const typed = parseTypedData(parsed.value.typedData);
    if (typed === null) return badRequest();
    const maxValue = capFor(deps, session.address);
    if (maxValue === null) {
      return fail(403, "envelope-closed", "Refused. The envelope is closed.");
    }
    const verdict = checkTypedData(typed, {
      address: session.address.toLowerCase(),
      escrows: deps.escrows(),
      maxValue,
    });
    if (!verdict.ok) return notAllowed(verdict.reason);
    try {
      const signature = await deps.wallets.signTypedData(session.walletId, typed);
      return json({ signature, address: session.address });
    } catch (error) {
      if (error instanceof WalletApiError) {
        return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
      }
      return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
    }
  }

  if (parsed.value.kind === "message") {
    if (typeof parsed.value.message !== "string") return badRequest();
    const verdict = checkMessage(parsed.value.message);
    if (!verdict.ok) return notAllowed(verdict.reason);
    try {
      const signature = await deps.wallets.personalSign(session.walletId, parsed.value.message);
      return json({ signature, address: session.address });
    } catch (error) {
      if (error instanceof WalletApiError) {
        return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
      }
      return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
    }
  }

  return badRequest();
}

function activeSession(c: Context, deps: CliAuthDeps): CliSessionRecord | null {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  const token = match?.[1] ?? "";
  if (token === "") return null;
  const session = deps.store.getSession(hash(token));
  if (session === null || session.revokedAt !== null || session.expiresAt <= deps.now()) return null;
  return session;
}

function capFor(deps: CliAuthDeps, address: string): bigint | null {
  const mirror = deps.hubStore.getEnvelopeMirror(address);
  if (mirror === null) return HARD_CAP;
  const envelope = mirror.envelope;
  if (envelope.revoked) return null;
  if (envelope.expiresAt !== undefined && envelope.expiresAt <= deps.now()) return null;
  try {
    return BigInt(envelope.perMerchant);
  } catch {
    return 0n;
  }
}

function parseTypedData(value: unknown): TypedDataInput | null {
  if (!isRecord(value)) return null;
  const { domain, types, primaryType, message } = value;
  if (!isRecord(domain) || !isRecord(types) || typeof primaryType !== "string" || !isRecord(message)) {
    return null;
  }
  for (const fields of Object.values(types)) {
    if (!Array.isArray(fields)) return null;
    for (const field of fields) {
      if (!isRecord(field) || typeof field.name !== "string" || typeof field.type !== "string") {
        return null;
      }
    }
  }
  return { domain, types: types as TypedDataInput["types"], primaryType, message };
}

function newCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (const byte of bytes) raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type LimitedJson =
  | { kind: "ok"; value: unknown }
  | { kind: "too-large" }
  | { kind: "malformed" };

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

function tooLarge(): Response {
  return fail(413, "too-large", "Refused. The request body is too large.");
}

function notSignedIn(): Response {
  return fail(401, "not-signed-in", NOT_SIGNED_IN);
}

function notAllowed(reason: string): Response {
  return json(
    { code: "not-allowed", message: "Refused. The hub will not sign that.", reason },
    403,
  );
}
