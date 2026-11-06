// Scheduled checkout on the hedera rail. The buyer creates a scheduled USDC transfer and signs the
// create; the seller checks the scheduled body and adds the second signature. The transfer runs the
// moment both keys have signed, or expires without moving anything. This module holds the seller's
// check-before-signing and the mirror reads that make the schedule's state honest.
import {
  type Client,
  ScheduleInfoQuery,
  ScheduleSignTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { HBAR, MIRROR_TESTNET } from "./constants.ts";
import { InspectError, type InspectedTransfer, type TransferRefusal } from "./inspect.ts";
import { offerHashFromMemo } from "./memo.ts";
import {
  getTransaction,
  MirrorError,
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
  const f = opts.fetch ?? fetch;
  const path = `/api/v1/schedules/${scheduleId}`;
  const r = await f((opts.base ?? MIRROR_TESTNET) + path);
  if (r.status === 404) return null;
  if (!r.ok) throw new MirrorError(path, r.status);
  return normalizeSchedule((await r.json()) as RawSchedule);
}

/** Unix seconds from either a mirror timestamp ("seconds.nanos") or an ISO date-time. */
function secondsOf(value: string | null | undefined): number | null {
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

// A schedule's transaction_body is a SchedulableTransactionBody, not a full TransactionBody: its
// transfer field is 9, its memo field is 2, and it carries no transaction id. Decode just enough of
// the protobuf to check the transfer; the SDK has no public decoder for this body on its own.
interface WireField {
  no: number;
  wire: number;
  bytes?: Uint8Array;
  number?: bigint;
}

function readFields(bytes: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let i = 0;
  const varint = (): bigint => {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= bytes.length) throw new InspectError("scheduled body is truncated");
      const byte = bytes[i++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      fields.push({ no, wire, number: varint() });
    } else if (wire === 2) {
      const length = Number(varint());
      if (length < 0 || i + length > bytes.length) throw new InspectError("scheduled body is truncated");
      fields.push({ no, wire, bytes: bytes.subarray(i, i + length) });
      i += length;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new InspectError("scheduled body uses an unsupported protobuf wire type");
    }
  }
  return fields;
}

function decodeAccount(fields: WireField[]): string {
  let shard = 0n;
  let realm = 0n;
  let num: bigint | null = null;
  let alias: Uint8Array | null = null;
  for (const f of fields) {
    if (f.wire === 0 && f.no === 1) shard = f.number!;
    else if (f.wire === 0 && f.no === 2) realm = f.number!;
    else if (f.wire === 0 && f.no === 3) num = f.number!;
    else if (f.wire === 2 && f.no === 4) alias = f.bytes!;
  }
  if (num !== null) return `${shard}.${realm}.${num}`;
  if (alias) return `0x${Buffer.from(alias).toString("hex")}`;
  throw new InspectError("scheduled transfer names an account without a number");
}

function decodeToken(fields: WireField[]): string {
  let shard = 0n;
  let realm = 0n;
  let num: bigint | null = null;
  for (const f of fields) {
    if (f.wire === 0 && f.no === 1) shard = f.number!;
    else if (f.wire === 0 && f.no === 2) realm = f.number!;
    else if (f.wire === 0 && f.no === 3) num = f.number!;
  }
  if (num === null) throw new InspectError("scheduled transfer names a token without a number");
  return `${shard}.${realm}.${num}`;
}

function zigzag(value: bigint): bigint {
  return (value >> 1n) ^ -(value & 1n);
}

interface AccountAmount {
  account: string;
  amount: bigint;
}

function decodeAccountAmounts(fields: WireField[]): AccountAmount[] {
  let account: string | null = null;
  let amount = 0n;
  for (const f of fields) {
    if (f.wire === 2 && f.no === 1) account = decodeAccount(readFields(f.bytes!));
    else if (f.wire === 0 && f.no === 2) amount = zigzag(f.number!);
  }
  if (!account) throw new InspectError("scheduled transfer has an amount without an account");
  return [{ account, amount }];
}

function decodeTransferList(fields: WireField[]): AccountAmount[] {
  return fields.filter((f) => f.wire === 2 && f.no === 1).flatMap((f) => decodeAccountAmounts(readFields(f.bytes!)));
}

interface DecodedTokenTransfers {
  token: string;
  amounts: AccountAmount[];
  nftCount: number;
}

function decodeTokenTransfers(fields: WireField[]): DecodedTokenTransfers {
  let token: string | null = null;
  const amounts: AccountAmount[] = [];
  let nftCount = 0;
  for (const f of fields) {
    if (f.wire === 2 && f.no === 1) token = decodeToken(readFields(f.bytes!));
    else if (f.wire === 2 && f.no === 2) amounts.push(...decodeAccountAmounts(readFields(f.bytes!)));
    else if (f.wire === 2 && f.no === 3) nftCount++;
  }
  if (!token) throw new InspectError("scheduled transfer has token amounts without a token");
  return { token, amounts, nftCount };
}

/** Find the scheduled transfer body, also accepting a create transaction that still wraps it. */
function transferBody(bytes: Uint8Array): Uint8Array {
  const fields = readFields(bytes);
  if (fields.some((f) => f.wire === 2 && f.no === 9)) return bytes;

  // A TransactionBody or a ScheduleCreateTransactionBody still holding the scheduled transfer.
  const fromCreate = (createBody: Uint8Array): Uint8Array | null => {
    const scheduleCreate = readFields(createBody).find((f) => f.wire === 2 && f.no === 42)?.bytes;
    const scheduled = readFields(scheduleCreate ?? createBody).find((f) => f.wire === 2 && f.no === 1)?.bytes;
    return scheduled && readFields(scheduled).some((f) => f.wire === 2 && f.no === 9) ? scheduled : null;
  };

  // TransactionList -> Transaction -> SignedTransaction.bodyBytes -> TransactionBody.
  const list = fields.find((f) => f.wire === 2 && f.no === 1)?.bytes;
  if (list) {
    const signed = readFields(list).find((f) => f.wire === 2 && f.no === 5)?.bytes;
    const body = signed ? readFields(signed).find((f) => f.wire === 2 && f.no === 1)?.bytes : undefined;
    const scheduled = body ? fromCreate(body) : null;
    if (scheduled) return scheduled;
  }

  const scheduled = fromCreate(bytes);
  if (scheduled) return scheduled;

  throw new InspectError("scheduled body is not a TransferTransaction");
}

/** Decode the transfer inside a schedule's transaction_body, in the shape decodeTransfer returns. */
export function inspectScheduled(bodyBase64: string): InspectedTransfer {
  const raw = Buffer.from(bodyBase64, "base64");
  if (raw.length === 0) throw new InspectError("scheduled body is empty");
  const bytes = transferBody(raw);
  const fields = readFields(bytes);
  const cryptoTransfer = fields.find((f) => f.wire === 2 && (f.no === 9 || f.no === 14))!;
  const fullBody = cryptoTransfer.no === 14;
  const memo = fields.find((f) => f.wire === 2 && f.no === (fullBody ? 6 : 2));
  const body = readFields(cryptoTransfer.bytes!);

  const hbar: InspectedTransfer["hbar"] = [];
  for (const f of body) {
    if (f.wire === 2 && f.no === 1) hbar.push(...decodeTransferList(readFields(f.bytes!)));
  }
  const tokens: InspectedTransfer["tokens"] = {};
  let nftCount = 0;
  for (const f of body) {
    if (f.wire !== 2 || f.no !== 2) continue;
    const list = decodeTokenTransfers(readFields(f.bytes!));
    (tokens[list.token] ??= []).push(...list.amounts);
    nftCount += list.nftCount;
  }

  return {
    // A schedulable body carries no transaction id, fee payer, validity window or signatures.
    transactionId: "",
    feePayer: "",
    validStart: 0,
    validDurationSeconds: 0,
    memo: memo?.bytes ? new TextDecoder().decode(memo.bytes) : "",
    hbar,
    tokens,
    nftCount,
    signerCount: 0,
  };
}

function inspectScheduledTransaction(tx: TransferTransaction): InspectedTransfer {
  const hbar = [...tx.hbarTransfers].map(([account, amount]) => ({
    account: account.toString(),
    amount: BigInt(amount.toTinybars().toString()),
  }));
  const tokens: InspectedTransfer["tokens"] = {};
  for (const [token, byAccount] of tx.tokenTransfers) {
    tokens[token.toString()] = [...byAccount].map(([account, amount]) => ({
      account: account.toString(),
      amount: BigInt(amount.toString()),
    }));
  }
  let nftCount = 0;
  for (const list of tx.nftTransfers.values()) nftCount += list.length;
  return {
    transactionId: "",
    feePayer: "",
    validStart: 0,
    validDurationSeconds: 0,
    memo: tx.transactionMemo,
    hbar,
    tokens,
    nftCount,
    signerCount: 0,
  };
}

export class ScheduleRefusedError extends Error {
  override name = "ScheduleRefusedError";
  constructor(
    readonly reason: ScheduleStatus | "missing" | "mismatch" | "not_a_transfer",
    message: string,
    readonly refusal?: ScheduledRefusal,
  ) {
    super(message);
  }
}

export interface CountersignOptions extends MirrorOptions {
  now?: () => number;
}

/**
 * Check the schedule and, only when it is still pending and exactly the expected transfer, add the
 * seller's signature. Returns the ScheduleSign transaction id.
 */
export async function countersignSchedule(
  sellerClient: Client,
  scheduleId: string,
  expected: ExpectedScheduledTransfer,
  opts: CountersignOptions = {},
): Promise<string> {
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  const record = await getSchedule(scheduleId, opts);
  let inspected: InspectedTransfer;

  if (record) {
    const status = statusOf(record, now);
    if (status !== "pending") throw new ScheduleRefusedError(status, `Refused. The schedule is ${status}.`);
    inspected = inspectScheduled(record.transactionBody);
  } else {
    // The mirror node can lag a fresh schedule; ask a node for the same facts.
    const info = await new ScheduleInfoQuery().setScheduleId(scheduleId).execute(sellerClient);
    const expires = info.expirationTime ? Number(info.expirationTime.seconds.toString()) : null;
    const status: ScheduleStatus = info.deleted
      ? "deleted"
      : info.executed
        ? "executed"
        : expires !== null && now >= expires
          ? "expired"
          : "pending";
    if (status !== "pending") throw new ScheduleRefusedError(status, `Refused. The schedule is ${status}.`);
    const scheduled = info.scheduledTransaction;
    if (!(scheduled instanceof TransferTransaction)) {
      throw new ScheduleRefusedError("not_a_transfer", "Refused. The schedule does not hold a token transfer.");
    }
    inspected = inspectScheduledTransaction(scheduled);
  }

  const check = checkScheduledTransfer(inspected, expected);
  if (!check.ok) throw new ScheduleRefusedError("mismatch", check.message, check.reason);

  const response = await new ScheduleSignTransaction().setScheduleId(scheduleId).execute(sellerClient);
  await response.getReceipt(sellerClient);
  return response.transactionId.toString();
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
