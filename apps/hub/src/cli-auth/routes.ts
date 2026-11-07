import { createHash, randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { bytesToHex, hexToBytes, keccak256, recoverPublicKey, toBytes, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import {
  signPrivyTransfer,
  validatePrivyTransfer,
  type PrivyTransferTerms,
} from "@countersign/rail/hedera";
import { personFrom, type PrivyVerifier } from "../privy.ts";
import type { Store } from "../store.ts";
import {
  WalletApiError,
  type TypedDataInput,
  type WalletApi,
} from "../wallets/privy-wallets.ts";
import { checkMessage, checkTypedData, HARD_CAP, type KnownEscrow } from "./policy.ts";
import type { CliAuthStore, CliSessionRecord } from "./store.ts";

export interface HederaSignTerms {
  offerHash: string;
  asset: string;
  amount: bigint;
  payTo: string;
  feePayer: string;
}

export interface CliHederaDeps {
  /** The live hedera rail's own challenge for a listed offer, or null when it has none. */
  terms: (offerHash: string) => HederaSignTerms | null;
  createAccount: (compressedPublicKey: string) => Promise<{ accountId: string }>;
  /** How many accounts may be created across all users in an hour. Defaults to 20. */
  hourlyCap?: number;
}

export interface CliAuthDeps {
  store: CliAuthStore;
  wallets: WalletApi;
  privy?: PrivyVerifier;
  hubStore: Store;
  escrows: () => KnownEscrow[];
  consoleUrl: string;
  now: () => number;
  /** Present only while HEDERA_PRIVY is on and its operator and the hedera rail are ready. */
  hedera?: CliHederaDeps;
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
  if (deps.hedera) {
    app.post("/cli/hedera/account", (c) => provisionHedera(c, deps));
    app.post("/cli/sign/hedera", (c) => signHedera(c, deps));
  }
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
  if (login.userId !== null) {
    return fail(409, "already-approved", "Refused. That code was already approved.");
  }

  let wallet = deps.store.getWallet(signIn.person.userId);
  if (wallet === null) {
    try {
      const externalId = `cs_${hash(signIn.person.userId).slice(0, 40)}`;
      const created =
        (await deps.wallets.findWallet(externalId)) ??
        (await deps.wallets.createWallet(externalId));
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
  const body: Record<string, unknown> = { address: session.address, expiresAt: session.expiresAt };
  if (deps.hedera) {
    const row = deps.store.getHedera(session.userId);
    body.hedera = row?.state === "ready" && row.accountId !== null ? { accountId: row.accountId } : null;
  }
  return json(body);
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

async function provisionHedera(c: Context, deps: CliAuthDeps): Promise<Response> {
  const hedera = deps.hedera;
  if (!hedera) return notFound();
  const session = activeSession(c, deps);
  if (session === null) return notSignedIn();

  const ready = deps.store.getHedera(session.userId);
  if (ready?.state === "ready" && ready.accountId !== null && ready.publicKey !== null) {
    return json({ accountId: ready.accountId, publicKey: ready.publicKey });
  }

  const now = deps.now();
  const cap = hedera.hourlyCap ?? 20;
  if (deps.store.hederaCreatedSince(now - 3600) >= cap) {
    return fail(429, "provisioning-capped", "Refused. Too many Hedera accounts were created this hour.");
  }

  if (!deps.store.claimHedera(session.userId, now)) {
    const row = deps.store.getHedera(session.userId);
    if (row?.state === "ready" && row.accountId !== null && row.publicKey !== null) {
      return json({ accountId: row.accountId, publicKey: row.publicKey });
    }
    if (row?.state === "failed") return provisioningFailed();
    return fail(409, "provisioning", "Refused. This Hedera account is already being provisioned.");
  }

  try {
    const externalId = `csh_${hash(session.userId).slice(0, 40)}`;
    const wallet =
      (await deps.wallets.findWallet(externalId)) ?? (await deps.wallets.createWallet(externalId));
    const rawSign = deps.wallets.rawSign;
    if (!rawSign) throw new Error("raw signing is unavailable");
    const keyHash = keccak256(toBytes(`countersign hedera key ${wallet.address}`));
    const signature = await rawSign(wallet.id, keyHash);
    const recovered = await recoverPublicKey({ hash: keyHash, signature });
    if (publicKeyToAddress(recovered).toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("the wallet's key does not match its address");
    }
    const publicKey = compressPublicKey(recovered);
    const created = await hedera.createAccount(publicKey);
    deps.store.readyHedera(session.userId, {
      walletId: wallet.id,
      evmAddress: wallet.address.toLowerCase(),
      publicKey,
      accountId: created.accountId,
    });
    return json({ accountId: created.accountId, publicKey });
  } catch {
    deps.store.failHedera(session.userId);
    return provisioningFailed();
  }
}

async function signHedera(c: Context, deps: CliAuthDeps): Promise<Response> {
  const hedera = deps.hedera;
  if (!hedera) return notFound();
  const session = activeSession(c, deps);
  if (session === null) return notSignedIn();

  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return tooLarge();
  if (parsed.kind === "malformed") return badRequest();
  if (!isRecord(parsed.value)) return badRequest();
  const keys = Object.keys(parsed.value).sort();
  if (keys.length !== 2 || keys[0] !== "offerHash" || keys[1] !== "transactionBytes") return badRequest();
  const { offerHash, transactionBytes } = parsed.value;
  if (typeof offerHash !== "string" || typeof transactionBytes !== "string") return badRequest();
  if (!/^0x[0-9a-fA-F]{64}$/.test(offerHash)) return badRequest();
  const hash = offerHash.toLowerCase();

  const row = deps.store.getHedera(session.userId);
  if (
    row?.state !== "ready" ||
    row.accountId === null ||
    row.publicKey === null ||
    row.walletId === null ||
    row.evmAddress === null
  ) {
    return fail(409, "no-hedera-account", "Refused. No Hedera account is ready for this login.");
  }

  const stored = deps.hubStore.getOffer(hash);
  if (stored === null || stored.delistedAt !== null) {
    return fail(404, "unknown-offer", "Refused. That offer is not listed.");
  }
  if (!Array.isArray(stored.offer.rails) || !stored.offer.rails.includes("hedera")) {
    return fail(400, "hedera-not-offered", "Refused. That offer does not take the hedera rail.");
  }
  const terms = hedera.terms(hash);
  if (terms === null) {
    return fail(503, "hedera-unavailable", "Refused. The hedera rail cannot answer right now.");
  }

  const envelopeCap = capFor(deps, session.address);
  if (envelopeCap === null) {
    return fail(403, "envelope-closed", "Refused. The envelope is closed.");
  }
  const expected: PrivyTransferTerms = {
    accountId: row.accountId,
    asset: terms.asset,
    amount: terms.amount,
    payTo: terms.payTo,
    feePayer: terms.feePayer,
    offerHash: hash,
    cap: envelopeCap < HARD_CAP ? envelopeCap : HARD_CAP,
  };
  const verdict = validatePrivyTransfer(transactionBytes, expected, deps.now());
  if (!verdict.ok) return notAllowed(verdict.reason);

  const rawSign = deps.wallets.rawSign;
  if (!rawSign) return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
  const storedKey = row.publicKey.toLowerCase();
  try {
    const signed = await signPrivyTransfer(verdict.tx, {
      publicKey: row.publicKey,
      sign: async (bodyBytes) => {
        const hash = keccak256(bodyBytes);
        const signature = await rawSign(row.walletId!, hash);
        if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("unexpected signature shape");
        const recovered = await recoverPublicKey({ hash, signature });
        if (compressPublicKey(recovered).toLowerCase() !== storedKey) {
          throw new Error("the signature does not match the stored key");
        }
        return hexToBytes(`0x${signature.slice(2, 130)}`);
      },
    });
    return json({
      transactionBytes: Buffer.from(signed.toBytes()).toString("base64"),
      accountId: row.accountId,
    });
  } catch {
    return fail(502, "privy-failed", "Refused. The wallet service did not answer.");
  }
}

function compressPublicKey(publicKey: Hex): string {
  const bytes = hexToBytes(publicKey);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("not an uncompressed public key");
  const y = BigInt(bytesToHex(bytes.slice(33)));
  return `0x${y % 2n === 0n ? "02" : "03"}${bytesToHex(bytes.slice(1, 33)).slice(2)}`;
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

function notFound(): Response {
  return fail(404, "not-found", "Refused. There is nothing at that path.");
}

function provisioningFailed(): Response {
  return fail(502, "hedera-provision-failed", "Refused. The Hedera account could not be created.");
}

function notAllowed(reason: string): Response {
  return json(
    { code: "not-allowed", message: "Refused. The hub will not sign that.", reason },
    403,
  );
}
