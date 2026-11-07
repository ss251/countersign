// HashPack on the console: a WalletConnect dApp session on hedera:testnet that signs one frozen
// transfer body at a time. The console builds with the buyer's own builder, hands the single node's
// TransactionBody to the wallet, appends the returned SignatureMap to that SignedTransaction, and
// sends the same x402 payment the agent sends. Nothing here ever holds a key or logs the project id.
import { useSyncExternalStore } from "react";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type CallResult,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import {
  FACILITATORS,
  HEDERA_TESTNET,
  USDC_TESTNET,
} from "../../../../packages/rail/src/hedera/constants.ts";
import type { RemoteHederaSigner } from "../../../../packages/buyer/src/hedera/signer.ts";
import type { Listing } from "./types.ts";

/** The HashPack extension announces itself under this id through HWC's extension bridge. */
const HASHPACK_EXTENSION_ID = "hashpack";
/** One testnet node, so the one signature HashPack returns belongs to the one frozen body. */
const HEDERA_NODE = "0.0.3";

const env = import.meta.env as ImportMetaEnv & {
  readonly VITE_HASHPACK?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
};

export const HASHPACK_ENABLED = env.VITE_HASHPACK?.trim() === "1";

const PROJECT_ID = env.VITE_WALLETCONNECT_PROJECT_ID?.trim() || undefined;

export type HashPackStatus = "disconnected" | "connecting" | "connected" | "error";

export interface HashPackState {
  status: HashPackStatus;
  accountId: string | null;
  error: string | null;
}

let state: HashPackState = { status: "disconnected", accountId: null, error: null };
const listeners = new Set<() => void>();

function setState(next: HashPackState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function hashPackState(): HashPackState {
  return state;
}

export function subscribeHashPack(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHashPack(): HashPackState {
  return useSyncExternalStore(subscribeHashPack, hashPackState, hashPackState);
}

export function hashpackEnabled(value: string | undefined): boolean {
  return value?.trim() === "1";
}

/** A message that can be shown: never the project id, even if a wallet library puts it in an error. */
function shown(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return PROJECT_ID ? message.split(PROJECT_ID).join("[redacted]") : message;
}

interface WalletRequestInput {
  method: "hedera_signTransaction";
  params: { signerAccountId: string; transactionBody: string };
}

interface WalletRequestResult {
  signatureMap: string;
}

export type WalletRequest = (request: WalletRequestInput) => Promise<WalletRequestResult>;

interface WalletSigner {
  readonly topic: string;
  request<T>(request: WalletRequestInput): Promise<T>;
  getAccountId(): { toString(): string };
}

interface WalletConnector {
  extensions: Array<{ id: string; available: boolean }>;
  signers: WalletSigner[];
  init(opts?: { logger?: unknown }): Promise<void>;
  connectExtension(extensionId: string): Promise<{ topic: string }>;
  openModal(): Promise<{ topic: string }>;
  disconnect(topic: string): Promise<boolean>;
}

interface Session {
  accountId: string;
  connector: WalletConnector;
  signer: WalletSigner;
}

let session: Session | null = null;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function connectorFor(): Promise<WalletConnector> {
  const [{ DAppConnector }, { LedgerId }] = await Promise.all([
    import("@hashgraph/hedera-wallet-connect/dist/lib/dapp/index.js"),
    import("@hiero-ledger/sdk"),
  ]);
  const url = window.location.origin;
  const connector = new DAppConnector(
    {
      name: "countersign",
      description: "Pay a countersigned offer with HashPack.",
      url,
      icons: [`${url}/favicon.svg`],
    },
    LedgerId.TESTNET,
    PROJECT_ID!,
    ["hedera_signTransaction"],
  );
  await connector.init();
  return connector as unknown as WalletConnector;
}

/** Wait for HWC's extension bridge to answer, so a HashPack extension is preferred over the QR modal. */
async function extensionReady(connector: WalletConnector): Promise<boolean> {
  const deadline = Date.now() + 600;
  for (;;) {
    if (connector.extensions.some((ext) => ext.id === HASHPACK_EXTENSION_ID && ext.available)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export interface HashPackConnection {
  accountId: string;
  disconnect: () => Promise<void>;
}

/** Connect to HashPack, reusing a WalletConnect session HWC already restored. */
export async function connectHashPack(): Promise<HashPackConnection> {
  if (!HASHPACK_ENABLED) throw new Error("HashPack is not enabled on this console.");
  if (!PROJECT_ID) throw new Error("HashPack is not set up on this console.");
  if (session) {
    return { accountId: session.accountId, disconnect: disconnectHashPack };
  }
  setState({ status: "connecting", accountId: null, error: null });
  try {
    const connector = await connectorFor();
    if (connector.signers.length === 0) {
      if (await extensionReady(connector)) await connector.connectExtension(HASHPACK_EXTENSION_ID);
      else await connector.openModal();
    }
    const signer = connector.signers[0];
    if (!signer) throw new Error("HashPack connected no account.");
    session = { accountId: signer.getAccountId().toString(), connector, signer };
    setState({ status: "connected", accountId: session.accountId, error: null });
    return { accountId: session.accountId, disconnect: disconnectHashPack };
  } catch (error) {
    const message = shown(error);
    session = null;
    setState({ status: "error", accountId: null, error: message });
    throw new Error(message);
  }
}

export async function disconnectHashPack(): Promise<void> {
  const current = session;
  session = null;
  setState({ status: "disconnected", accountId: null, error: null });
  if (current) await current.connector.disconnect(current.signer.topic);
}

function requestFor(accountId: string): WalletRequest {
  return async (request) => {
    if (!session || session.accountId !== accountId) {
      throw new Error("HashPack is not connected. Connect it in the sign-in menu first.");
    }
    return session.signer.request<WalletRequestResult>(request);
  };
}

/**
 * The console's signer. It takes the builder's frozen TransactionList, extracts the one node's
 * TransactionBody, asks HashPack for its SignatureMap, and appends those sigPairs to that same
 * SignedTransaction. The returned base64 is the agent's transaction, now carrying the user's signature.
 */
export function hashpackSigner(accountId: string, opts: { request?: WalletRequest } = {}): RemoteHederaSigner {
  const request = opts.request ?? requestFor(accountId);
  return {
    remote: true,
    async signTransfer(transactionBytes: string, _offerHash: string): Promise<string> {
      const { proto } = await import("@hiero-ledger/proto");
      const list = proto.TransactionList.decode(bytes(transactionBytes));
      if (list.transactionList.length !== 1) {
        throw new Error("HashPack signs one node at a time; this transfer was frozen with more than one.");
      }
      const transaction = list.transactionList[0]!;
      if (!transaction.signedTransactionBytes || transaction.signedTransactionBytes.length === 0) {
        throw new Error("The frozen transfer has no body to sign.");
      }
      const signed = proto.SignedTransaction.decode(transaction.signedTransactionBytes);
      const { signatureMap } = await request({
        method: "hedera_signTransaction",
        params: {
          signerAccountId: `${HEDERA_TESTNET}:${accountId}`,
          transactionBody: base64(signed.bodyBytes),
        },
      });
      const wallet = proto.SignatureMap.decode(bytes(signatureMap));
      const existing = signed.sigMap ?? proto.SignatureMap.create({});
      const merged = proto.SignatureMap.create({
        sigPair: [...(existing.sigPair ?? []), ...(wallet.sigPair ?? [])],
      });
      const next = proto.SignedTransaction.encode({
        bodyBytes: signed.bodyBytes,
        sigMap: merged,
      }).finish();
      const out = proto.TransactionList.encode({
        transactionList: [{ signedTransactionBytes: next }],
      }).finish();
      return base64(out);
    },
  };
}

/** The hosted facilitators' published Hedera testnet fee payers, pinned (x402.org's /supported sends no CORS header). */
export const PINNED_FEE_PAYERS: readonly string[] = ["0.0.9185802"];

/** The fee payers this page trusts: the pinned set plus whatever the CORS-readable facilitators publish. */
export async function trustedHashPackFeePayers(fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  const found = new Set<string>(PINNED_FEE_PAYERS);
  await Promise.all(
    FACILITATORS.map(async ({ url }) => {
      try {
        const response = await fetchImpl(`${url}/supported`, { method: "GET" });
        if (!response.ok) return;
        const body = (await response.json()) as { kinds?: unknown };
        if (!Array.isArray(body.kinds)) return;
        for (const kind of body.kinds) {
          if (typeof kind !== "object" || kind === null) continue;
          const entry = kind as { x402Version?: unknown; scheme?: unknown; network?: unknown; extra?: unknown };
          if (entry.x402Version !== 2 || entry.scheme !== "exact" || entry.network !== HEDERA_TESTNET) continue;
          const extra = entry.extra as { feePayer?: unknown } | undefined;
          if (typeof extra?.feePayer === "string") found.add(extra.feePayer);
        }
      } catch {
        // An unreachable facilitator contributes no fee payer.
      }
    }),
  );
  return found;
}

export type PayStep = "signed" | "working" | "checked" | "settled" | "minted";

export interface HashPackPayment {
  output: unknown;
  slip: CallResult["slip"];
  transactionId: string;
  settlementUrl: string | null;
}

export interface PayWithHashPackInput {
  hub: string;
  listing: Pick<Listing, "hash" | "offer">;
  input: unknown;
}

export interface PayWithHashPackDeps {
  /** Test seam: the console's own signer is the default. */
  signer?: RemoteHederaSigner;
  /** Test seam: the account the injected signer speaks for. */
  accountId?: string;
  fetch?: typeof fetch;
  trustedFeePayers?: () => Promise<Set<string>>;
  nodeAccountId?: string;
  onStep?: (step: PayStep) => void;
}

function txKey(id: string): string {
  const match = id.match(/^(\d+\.\d+\.\d+)[@-](\d+)[.-](\d+)$/);
  if (!match) return id;
  return `${match[1]}@${match[2]}.${match[3]!.padStart(9, "0")}`;
}

async function hubMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (text === "") return fallback;
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string" && body.message !== "") return body.message;
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    // Not JSON: show the hub's words as they came.
  }
  return text;
}

/**
 * One payment at a time: the flag is set before the first await, so a second activation in the same
 * tick is ignored even though React has not re-rendered the disabled button yet.
 */
export function paymentOnce(flag: { current: boolean }, pay: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (flag.current) return;
    flag.current = true;
    try {
      await pay();
    } finally {
      flag.current = false;
    }
  };
}

/**
 * Read the hub's 402 exactly as the buyer agent does, take its hedera exact entry, sign the same
 * transfer in HashPack, and send the same payment header. Settling and the slip are the hub's.
 */
export async function payWithHashPack(
  input: PayWithHashPackInput,
  deps: PayWithHashPackDeps = {},
): Promise<HashPackPayment> {
  const accountId = deps.accountId ?? session?.accountId;
  if (!accountId) throw new Error("HashPack is not connected. Connect it in the sign-in menu first.");
  const signer = deps.signer ?? hashpackSigner(accountId);
  const fetchImpl = deps.fetch ?? fetch;
  const base = input.hub.replace(/\/+$/, "");
  const url = `${base}/offers/${input.listing.hash}/call`;
  const body = JSON.stringify({ input: input.input });

  if (!input.listing.offer.rails.includes("hedera")) {
    throw new Error("Refused. This offer does not take the hedera rail.");
  }

  let first: Response;
  try {
    first = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  } catch {
    throw new Error("The hub did not answer, so nothing was signed.");
  }
  if (first.status !== 402) {
    const message = first.ok
      ? `The hub answered ${first.status} without asking for payment, so nothing was signed.`
      : await hubMessage(first, `The hub answered ${first.status}.`);
    throw new Error(message);
  }

  const required = await readRequired(first);
  if (!required) throw new Error("The hub's 402 carried no payment terms.");
  const req = required.accepts.find((entry) => entry.network === HEDERA_TESTNET && entry.scheme === "exact");
  if (!req) throw new Error("Refused. The hub offered no hedera payment for this offer.");
  if (req.scheme !== "exact" || req.network !== HEDERA_TESTNET) {
    throw new Error("Refused. The hub offered no hedera payment for this offer.");
  }
  if (req.asset !== USDC_TESTNET) throw new Error("Refused. The hub asked for a token this page will not sign.");
  const feePayer = req.extra?.feePayer;
  const trusted = deps.trustedFeePayers ?? (() => trustedHashPackFeePayers(fetchImpl));
  if (typeof feePayer !== "string" || !(await trusted()).has(feePayer)) {
    throw new Error("Refused. The hub named a fee payer this page does not trust.");
  }
  if (
    req.extra?.offerHash !== input.listing.hash ||
    req.amount !== input.listing.offer.price ||
    req.payTo !== input.listing.offer.payTo?.hedera
  ) {
    throw new Error("Refused. The hub asked for terms that differ from the offer.");
  }

  const { hederaPayment } = await import("../../../../packages/buyer/src/hedera/signer.ts");
  const { payment, transactionId } = await hederaPayment(
    { accountId, key: signer },
    req,
    url,
    { nodeAccountIds: [deps.nodeAccountId ?? HEDERA_NODE] },
  );
  deps.onStep?.("signed");

  deps.onStep?.("working");
  let second: Response;
  try {
    second = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PAYMENT_SIGNATURE_HEADER]: toBase64Json(payment),
      },
      body,
    });
  } catch {
    throw new Error("The hub did not answer, so this page cannot say whether the payment reached it.");
  }
  if (!second.ok) {
    throw new Error(await hubMessage(second, `The hub answered ${second.status}.`));
  }

  const result = (await second.json()) as CallResult;
  const settle = settleOf(second.headers.get(PAYMENT_RESPONSE_HEADER));
  if (settle && settle.success === false) {
    throw new Error(settle.errorReason ?? "The hub's settle result did not say the payment succeeded.");
  }
  const settled = settle?.transaction ?? result.slip?.settlement?.transaction;
  if (typeof settled === "string" && txKey(settled) !== txKey(transactionId)) {
    throw new Error(`The hub reported settlement ${settled}, but this page signed ${transactionId}.`);
  }
  deps.onStep?.("checked");
  deps.onStep?.("settled");
  deps.onStep?.("minted");
  const settlementUrl = result.slip?.settlement?.url ?? null;
  return { output: result.output, slip: result.slip, transactionId, settlementUrl };
}

async function readRequired(response: Response): Promise<PaymentRequired | null> {
  // The agent reads the header first; the body is only a fallback for hubs that send no header.
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header) {
    try {
      const parsed = fromBase64Json<PaymentRequired>(header);
      if (Array.isArray(parsed.accepts)) return parsed;
    } catch {
      // A broken header falls through to the body.
    }
  }
  try {
    const body = (await response.json()) as { accepts?: unknown };
    if (typeof body === "object" && body !== null && Array.isArray(body.accepts)) {
      return body as PaymentRequired;
    }
  } catch {
    // Not JSON, and no usable header.
  }
  return null;
}

function settleOf(header: string | null): SettleResult | null {
  if (!header) return null;
  try {
    return fromBase64Json<SettleResult>(header);
  } catch {
    return null;
  }
}

export type { PaymentPayload, PaymentRequirements };
