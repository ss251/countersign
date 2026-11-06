// Scheduled checkout on the hedera rail. The buyer creates a scheduled USDC transfer and signs the
// create; the seller checks the scheduled body and adds the second signature. The transfer runs the
// moment both keys have signed, or expires without moving anything. This module holds the seller's
// check-before-signing and the mirror reads that make the schedule's state honest.
import { proto } from "@hiero-ledger/proto";
import {
  AccountId,
  Client,
  PrivateKey,
  ScheduleId,
  ScheduleSignTransaction,
  TransactionId,
} from "@hiero-ledger/sdk";
import { HBAR, MIRROR_TESTNET } from "./constants.ts";
import { InspectError, type InspectedTransfer, type TransferRefusal } from "./inspect.ts";
import { offerHashFromMemo } from "./memo.ts";
import {
  getTransaction,
  MirrorError,
  mirrorFetch,
  type MirrorOptions,
  type MirrorTransaction,
} from "./mirror.ts";

export type ScheduleStatus = "pending" | "executed" | "expired" | "deleted";

export interface MirrorSchedule {
  /** "0.0.1234" */
  id: string;
  creator: string | null;
  payer: string | null;
  memo: string;
  /** Consensus timestamp "seconds.nanos" when the scheduled transfer executed, or null. */
  executedTimestamp: string | null;
  /** Mirror form of the expiration time, kept as-is. */
  expirationTime: string | null;
  deleted: boolean;
  waitForExpiry: boolean;
  /** Base64 SchedulableTransactionBody: the transfer the seller is asked to sign. */
  transactionBody: string;
  signatures: unknown[];
}

interface RawSchedule {
  schedule_id: string;
  creator_account_id?: string | null;
  payer_account_id?: string | null;
  memo?: string;
  executed_timestamp?: string | null;
  expiration_time?: string | null;
  deleted?: boolean;
  wait_for_expiry?: boolean;
  transaction_body: string;
  signatures?: unknown[];
}

function normalizeSchedule(raw: RawSchedule): MirrorSchedule {
  return {
    id: raw.schedule_id,
    creator: raw.creator_account_id ?? null,
    payer: raw.payer_account_id ?? null,
    memo: raw.memo ?? "",
    executedTimestamp: raw.executed_timestamp ?? null,
    expirationTime: raw.expiration_time ?? null,
    deleted: raw.deleted === true,
    waitForExpiry: raw.wait_for_expiry === true,
    transactionBody: raw.transaction_body,
    signatures: raw.signatures ?? [],
  };
}

/** A schedule from the mirror node, or null when it is not there yet. */
export async function getSchedule(scheduleId: string, opts: MirrorOptions = {}): Promise<MirrorSchedule | null> {
  const path = `/api/v1/schedules/${scheduleId}`;
  const r = await mirrorFetch((opts.base ?? MIRROR_TESTNET) + path, opts);
  if (r.status === 404) return null;
  if (!r.ok) throw new MirrorError(path, r.status);
  return normalizeSchedule((await r.json()) as RawSchedule);
}

/** Unix seconds from either a mirror timestamp ("seconds.nanos") or an ISO date-time. */
export function secondsOf(value: string | null | undefined): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value.split(".")[0]);
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function statusOf(schedule: MirrorSchedule, nowSeconds: number): ScheduleStatus {
  if (schedule.deleted) return "deleted";
  if (schedule.executedTimestamp) return "executed";
  const expires = secondsOf(schedule.expirationTime);
  if (expires !== null && nowSeconds >= expires) return "expired";
  return "pending";
}

/** What a schedule is doing now. An executed schedule is never reported as expired. */
export async function scheduleStatus(
  scheduleId: string,
  opts: MirrorOptions & { now?: () => number } = {},
): Promise<ScheduleStatus> {
  const schedule = await getSchedule(scheduleId, opts);
  if (!schedule) throw new MirrorError(`/api/v1/schedules/${scheduleId}`, 404);
  return statusOf(schedule, (opts.now ?? (() => Math.floor(Date.now() / 1000)))());
}

/** What the seller expects to find inside the schedule before it signs. */
export interface ExpectedScheduledTransfer {
  asset: string;
  amount: bigint;
  payTo: string;
  offerHash: string;
  /** The buyer's account, the only account allowed to be debited. */
  payer: string;
}

export type ScheduledRefusal = TransferRefusal | "wrong_payer";

export type ScheduledCheck =
  | { ok: true; payer: string }
  | { ok: false; reason: ScheduledRefusal; message: string };

const refuse = (reason: ScheduledRefusal, message: string): ScheduledCheck => ({ ok: false, reason, message });

/**
 * The strict shape the seller signs: exactly two token entries, the buyer debited the offer's
 * amount and the seller credited the same, on one token, with the offer memo, and nothing else.
 */
export function checkScheduledTransfer(
  t: InspectedTransfer,
  want: ExpectedScheduledTransfer,
): ScheduledCheck {
  const memoHash = offerHashFromMemo(t.memo);
  if (!memoHash || memoHash !== want.offerHash.toLowerCase()) {
    return refuse("offer_mismatch", "Refused. The scheduled transfer names a different offer.");
  }
  if (want.asset === HBAR) {
    return refuse("wrong_asset", "Refused. This rail settles in an HTS token, not HBAR.");
  }
  const tokenIds = Object.keys(t.tokens);
  if (tokenIds.length !== 1 || tokenIds[0] !== want.asset) {
    return refuse("wrong_asset", `Refused. The scheduled transfer must move only ${want.asset}.`);
  }
  if (t.hbar.length > 0 || t.nftCount > 0) {
    return refuse("extra_transfers", "Refused. The schedule moves more than the price.");
  }
  const entries = t.tokens[want.asset]!;
  const credits = entries.filter((e) => e.amount > 0n);
  const debits = entries.filter((e) => e.amount < 0n);
  if (entries.length !== 2 || credits.length !== 1 || debits.length !== 1) {
    return refuse("extra_transfers", "Refused. The scheduled transfer must be one debit and one credit.");
  }
  const credit = credits[0]!;
  const debit = debits[0]!;
  if (credit.account !== want.payTo) {
    return refuse("wrong_payee", `Refused. The schedule pays ${credit.account}, not the seller ${want.payTo}.`);
  }
  if (credit.amount !== want.amount || -debit.amount !== want.amount) {
    return refuse("amount_mismatch", "Refused. The scheduled amount is not the offer's price.");
  }
  if (debit.account !== want.payer) {
    return refuse("wrong_payer", `Refused. The schedule debits ${debit.account}, not the buyer ${want.payer}.`);
  }
  return { ok: true, payer: debit.account };
}

function accountIdOf(id: proto.AccountID.$Properties | null | undefined): string {
  if (!id) throw new InspectError("scheduled transfer has an amount without an account");
  if (id.accountNum !== null && id.accountNum !== undefined) {
    const shard = id.shardNum != null ? id.shardNum.toString() : "0";
    const realm = id.realmNum != null ? id.realmNum.toString() : "0";
    return `${shard}.${realm}.${id.accountNum.toString()}`;
  }
  if (id.alias && id.alias.length > 0) return `0x${Buffer.from(id.alias).toString("hex")}`;
  throw new InspectError("scheduled transfer names an account without a number");
}

function tokenIdOf(id: proto.TokenID.$Properties | null | undefined): string {
  if (!id) throw new InspectError("scheduled transfer has token amounts without a token");
  const shard = id.shardNum != null ? id.shardNum.toString() : "0";
  const realm = id.realmNum != null ? id.realmNum.toString() : "0";
  const num = id.tokenNum != null ? id.tokenNum.toString() : "0";
  return `${shard}.${realm}.${num}`;
}

function collectAmounts(
  amounts: proto.AccountAmount.$Properties[],
  output: { account: string; amount: bigint }[],
): void {
  for (const entry of amounts) {
    if (entry.isApproval) throw new InspectError("allowance transfers are refused");
    output.push({ account: accountIdOf(entry.accountID), amount: BigInt((entry.amount ?? 0).toString()) });
  }
}

/**
 * Decode the transfer inside a schedule's transaction_body, in the shape decodeTransfer returns.
 * The mirror returns SchedulableTransactionBody bytes; every other shape is refused.
 */
export function inspectScheduled(bodyBase64: string): InspectedTransfer {
  const raw = Buffer.from(bodyBase64, "base64");
  if (raw.length === 0) throw new InspectError("scheduled body is empty");

  let decoded: proto.SchedulableTransactionBody;
  try {
    decoded = proto.SchedulableTransactionBody.decode(raw);
  } catch {
    throw new InspectError("scheduled body is not a SchedulableTransactionBody");
  }

  // Only an exact round trip proves the reader saw every byte: protobuf merges repeated message
  // members and the network keeps fields this decoder drops, so a looser read could approve a body
  // that executes something else.
  const reencoded = proto.SchedulableTransactionBody.encode(decoded).finish();
  if (!Buffer.from(reencoded).equals(raw)) {
    throw new InspectError("scheduled body is not in canonical form");
  }

  const allowed = new Set(["maxCustomFees", "transactionFee", "memo", "cryptoTransfer"]);
  for (const key of Object.keys(decoded)) {
    if (!allowed.has(key)) throw new InspectError(`scheduled body carries an unexpected field: ${key}`);
  }
  if (decoded.maxCustomFees.length > 0) throw new InspectError("scheduled body carries custom fees");
  if (decoded.data !== "cryptoTransfer" || !decoded.cryptoTransfer) {
    throw new InspectError("scheduled body is not a token transfer");
  }

  const hbar: InspectedTransfer["hbar"] = [];
  collectAmounts(decoded.cryptoTransfer.transfers?.accountAmounts ?? [], hbar);

  const tokens: InspectedTransfer["tokens"] = {};
  let nftCount = 0;
  for (const list of decoded.cryptoTransfer.tokenTransfers ?? []) {
    const token = tokenIdOf(list.token);
    collectAmounts(list.transfers ?? [], (tokens[token] ??= []));
    nftCount += (list.nftTransfers ?? []).length;
  }

  return {
    // A schedulable body carries no transaction id, fee payer, validity window or signatures.
    transactionId: "",
    feePayer: "",
    validStart: 0,
    validDurationSeconds: 0,
    memo: decoded.memo ?? "",
    hbar,
    tokens,
    nftCount,
    signerCount: 0,
  };
}

export class ScheduleRefusedError extends Error {
  override name = "ScheduleRefusedError";
  constructor(
    readonly reason: ScheduleStatus | "not_found" | "mismatch" | "wait_for_expiry" | "payer_mismatch",
    message: string,
    readonly refusal?: ScheduledRefusal,
  ) {
    super(message);
  }
}

export interface CountersignOptions extends MirrorOptions {
  now?: () => number;
  /** How often to ask the mirror for a schedule that has not appeared yet. */
  pollIntervalMs?: number;
  /** How long to wait for the mirror to show the schedule before refusing. */
  pollTimeoutMs?: number;
}

async function waitForMirrorSchedule(scheduleId: string, opts: CountersignOptions): Promise<MirrorSchedule> {
  const interval = opts.pollIntervalMs ?? 1_500;
  const timeout = opts.pollTimeoutMs ?? 20_000;
  const deadline = Date.now() + timeout;
  for (;;) {
    const record = await getSchedule(scheduleId, opts);
    if (record) return record;
    if (Date.now() >= deadline) {
      throw new ScheduleRefusedError(
        "not_found",
        "Refused. The schedule is not on the mirror node yet, so its body cannot be checked.",
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Every check the seller runs before its key signs the schedule. Throws a ScheduleRefusedError. */
async function checkBeforeCountersign(
  scheduleId: string,
  expected: ExpectedScheduledTransfer,
  opts: CountersignOptions,
): Promise<MirrorSchedule> {
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const record = await waitForMirrorSchedule(scheduleId, opts);
  const status = statusOf(record, now);
  if (status !== "pending") throw new ScheduleRefusedError(status, `Refused. The schedule is ${status}.`);
  if (record.waitForExpiry === true) {
    throw new ScheduleRefusedError(
      "wait_for_expiry",
      "Refused. The schedule waits for its expiry, so the seller's key would not pay now.",
    );
  }
  if (record.payer !== expected.payer) {
    throw new ScheduleRefusedError("payer_mismatch", "Refused. The schedule names a fee payer other than the buyer.");
  }
  const inspected = inspectScheduled(record.transactionBody);

  const check = checkScheduledTransfer(inspected, expected);
  if (!check.ok) throw new ScheduleRefusedError("mismatch", check.message, check.reason);
  return record;
}

/** A successful countersign is not payment: a seller delivers only after `waitForScheduledExecution` returns the executed transfer. */
export async function countersignSchedule(
  sellerClient: Client,
  scheduleId: string,
  expected: ExpectedScheduledTransfer,
  opts: CountersignOptions = {},
): Promise<string> {
  await checkBeforeCountersign(scheduleId, expected, opts);

  const response = await new ScheduleSignTransaction().setScheduleId(scheduleId).execute(sellerClient);
  await response.getReceipt(sellerClient);
  return response.transactionId.toString();
}

/**
 * Build and sign, without submitting, the seller's ScheduleSign for a held payment. The hub submits
 * these bytes only after a checked delivery, so the transfer cannot run before the seller is paid.
 */
export async function prepareCountersign(
  sellerAccountId: string,
  sellerKey: PrivateKey,
  scheduleId: string,
  expected: ExpectedScheduledTransfer,
  opts: CountersignOptions & { nodeAccountIds?: string[] } = {},
): Promise<{ bytes: string; transactionId: string }> {
  await checkBeforeCountersign(scheduleId, expected, opts);

  const transaction = new ScheduleSignTransaction()
    .setScheduleId(ScheduleId.fromString(scheduleId))
    .setTransactionId(TransactionId.generate(AccountId.fromString(sellerAccountId)));
  const nodeAccountIds = opts.nodeAccountIds;
  if (nodeAccountIds?.length) {
    transaction.setNodeAccountIds(nodeAccountIds.map((id) => AccountId.fromString(id)));
    transaction.freeze();
  } else {
    const client = Client.forTestnet();
    try {
      transaction.freezeWith(client);
    } finally {
      client.close();
    }
  }
  await transaction.sign(sellerKey);
  return {
    bytes: Buffer.from(transaction.toBytes()).toString("base64"),
    transactionId: transaction.transactionId!.toString(),
  };
}

/** The executed transfer record for a schedule create id, or a timeout. */
export async function waitForScheduledExecution(
  createTxId: string,
  opts: MirrorOptions & { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MirrorTransaction> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tx = await getTransaction(createTxId, { ...opts, scheduled: true }).catch(() => null);
    if (tx) return tx;
    if (Date.now() > deadline) {
      throw new Error(`scheduled execution for ${createTxId} not on the mirror node after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 1_500));
  }
}
