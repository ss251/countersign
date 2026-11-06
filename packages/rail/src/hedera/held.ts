// The held Hedera rail: the buyer creates a scheduled USDC transfer that needs the payee's
// signature, the hub verifies and holds it without moving money, and only a checked delivery
// lets the hub submit the seller's countersignature. A failed delivery leaves the schedule to
// expire unsigned, so nothing moves.
import {
  Client,
  ReceiptStatusError,
  ScheduleSignTransaction,
  StatusError,
  Transaction,
} from "@hiero-ledger/sdk";
import { keccak256, toBytes, type Hex } from "viem";
import {
  offerHash,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type VerifyResult,
} from "@countersign/core";
import type { ChallengeContext, EscrowOps, Rail, RailDeclaration } from "../rail.ts";
import { HASHSCAN_TESTNET, HEDERA_TESTNET, MIRROR_TESTNET, USDC_TESTNET } from "./constants.ts";
import { mirrorFetch, netFor, type MirrorOptions } from "./mirror.ts";
import { HEDERA_DECLARATION, type SettledStore } from "./rail.ts";
import {
  checkScheduledTransfer,
  getSchedule,
  inspectScheduled,
  secondsOf,
  waitForScheduledExecution,
  type MirrorSchedule,
} from "./schedule.ts";
import { toMirrorTxId } from "./txid.ts";

const ACCOUNT_ID = /^0\.0\.\d+$/;
const TRANSACTION_ID = /^0\.0\.\d+@\d+\.\d+$/;

/** A hold the hub keeps in memory between settle and release, refund or cancel. */
interface Hold {
  scheduleId: string;
  createTxId: string;
  payTo: string;
  asset: string;
  amount: string;
  payer: string;
}

export interface HeldRailOptions {
  mirror?: MirrorOptions;
  /** Unix seconds. */
  now?: () => number;
  /** Schedule ids already claimed. Defaults to an in-memory store. */
  seen?: SettledStore;
  /** Submit the seller's signed ScheduleSign. Defaults to an operator-less testnet client. */
  submit?: (tx: ScheduleSignTransaction) => Promise<{ status: string }>;
  /** How long the mirror has to show the schedule before verify refuses it. */
  waitScheduleMs?: number;
  /** How often verify asks the mirror for a schedule that has not appeared yet. */
  pollMs?: number;
  /** How long release waits for the scheduled execution on the mirror. */
  executionTimeoutMs?: number;
}

export interface HeldRail extends Rail {
  readonly declaration: RailDeclaration;
  readonly escrow: EscrowOps;
}

function memoryStore(): SettledStore {
  const ids = new Set<string>();
  return {
    has: (id) => ids.has(id),
    claim: (id) => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The hub holds no key: an operator-less client only submits the seller's frozen signature. */
async function submitWithTestnetClient(tx: ScheduleSignTransaction): Promise<{ status: string }> {
  const client = Client.forTestnet();
  try {
    const response = await tx.execute(client);
    await response.getReceipt(client);
    return { status: "SUCCESS" };
  } catch (error) {
    if (error instanceof ReceiptStatusError || error instanceof StatusError) {
      return { status: error.status.toString() };
    }
    throw error;
  } finally {
    client.close();
  }
}

export const HEDERA_SCHEDULED_DECLARATION: RailDeclaration = {
  id: "hedera-scheduled",
  network: HEDERA_TESTNET,
  scheme: "countersign",
  asset: HEDERA_DECLARATION.asset,
  kind: "escrow",
  gasPaidBy: "buyer",
  finality: "Hedera consensus when the seller's countersignature lands",
  explorerTx: `${HASHSCAN_TESTNET}/transaction/{tx}`,
  finalitySeconds: 5,
  cost: { tollBps: 0, fixed: "0" },
};

/** The hub's jobId for a held payment: a payload with no authorization.nonce. */
export function heldJobId(createTxId: string): Hex {
  return keccak256(toBytes(createTxId));
}

export async function createHederaHeldRail(opts: HeldRailOptions = {}): Promise<HeldRail> {
  const mirror = opts.mirror ?? {};
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const seen = opts.seen ?? memoryStore();
  const submit = opts.submit ?? submitWithTestnetClient;
  const waitScheduleMs = opts.waitScheduleMs ?? 20_000;
  const pollMs = opts.pollMs ?? 1_500;
  const executionTimeoutMs = opts.executionTimeoutMs ?? 60_000;
  const holds = new Map<Hex, Hold>();
  const verifiedPayer = new Map<string, string>();

  const invalid = (invalidReason: string): VerifyResult => ({ isValid: false, invalidReason });
  const fail = (errorReason: string): SettleResult => ({
    success: false,
    errorReason,
    transaction: "",
    network: HEDERA_TESTNET,
  });

  async function findSchedule(scheduleId: string): Promise<MirrorSchedule | null> {
    const deadline = Date.now() + waitScheduleMs;
    for (;;) {
      const schedule = await getSchedule(scheduleId, mirror);
      if (schedule) return schedule;
      if (Date.now() >= deadline) return null;
      await sleep(pollMs);
    }
  }

  /** The payload's createTxId must be this schedule's own successful SCHEDULECREATE. */
  async function findCreate(scheduleId: string, createTxId: string): Promise<boolean> {
    const path = `/api/v1/transactions/${toMirrorTxId(createTxId)}`;
    const deadline = Date.now() + waitScheduleMs;
    for (;;) {
      let matched = false;
      const r = await mirrorFetch((mirror.base ?? MIRROR_TESTNET) + path, mirror);
      if (r.ok) {
        const body: unknown = await r.json().catch(() => null);
        const transactions = isRecord(body) && Array.isArray(body.transactions) ? body.transactions : [];
        matched = transactions.some(
          (t) =>
            isRecord(t) && t.name === "SCHEDULECREATE" && t.entity_id === scheduleId && t.result === "SUCCESS",
        );
      }
      if (matched) return true;
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
  }

  async function readAccount(id: string): Promise<Record<string, unknown> | null> {
    const r = await mirrorFetch((mirror.base ?? MIRROR_TESTNET) + `/api/v1/accounts/${id}`, mirror);
    if (!r.ok) return null;
    try {
      const body: unknown = await r.json();
      return isRecord(body) ? body : null;
    } catch {
      return null;
    }
  }

  /** Drop a hold only once its schedule can no longer pay: executed, deleted, or expired. */
  async function dropHold(jobId: Hex): Promise<SettleResult> {
    const hold = holds.get(jobId);
    if (!hold) return fail("unknown_job");
    const schedule = await getSchedule(hold.scheduleId, mirror);
    if (!schedule) return fail("unknown_schedule");
    if (schedule.executedTimestamp) return fail("executed");
    const expires = secondsOf(schedule.expirationTime);
    if (!schedule.deleted && !(expires !== null && now() >= expires)) return fail("still_signable");
    holds.delete(jobId);
    return { success: true, payer: hold.payer, transaction: hold.createTxId, network: HEDERA_TESTNET };
  }

  const escrow: EscrowOps = {
    async release(jobId, _slipHash, _sellerSig, countersign) {
      const hold = holds.get(jobId);
      if (!hold) return fail("unknown_job");
      if (typeof countersign !== "string") return fail("no_countersign");

      let tx: Transaction;
      try {
        tx = Transaction.fromBytes(Buffer.from(countersign, "base64"));
      } catch {
        return fail("bad_countersign");
      }
      if (!(tx instanceof ScheduleSignTransaction)) return fail("bad_countersign");
      if (tx.scheduleId?.toString() !== hold.scheduleId) return fail("bad_countersign");
      if (tx.transactionId?.accountId?.toString() !== hold.payTo) return fail("bad_countersign");

      const receipt = await submit(tx);
      if (receipt.status !== "SUCCESS" && receipt.status !== "SCHEDULE_ALREADY_EXECUTED") {
        return fail(`submit_failed: ${receipt.status}`);
      }

      let record;
      try {
        record = await waitForScheduledExecution(hold.createTxId, { ...mirror, timeoutMs: executionTimeoutMs });
      } catch {
        return fail("execution_failed: timeout");
      }
      const moved = record.tokens[hold.asset] ?? [];
      const exact =
        record.result === "SUCCESS" &&
        netFor(moved, hold.payTo) === BigInt(hold.amount) &&
        netFor(moved, hold.payer) === -BigInt(hold.amount);
      if (!exact) return fail(`execution_failed: ${record.result}`);

      const schedule = await getSchedule(hold.scheduleId, mirror);
      if (!schedule?.executedTimestamp) return fail("execution_failed: schedule not executed");
      if (schedule.executedTimestamp !== record.consensusTimestamp) {
        return fail("execution_failed: schedule executed elsewhere");
      }

      holds.delete(jobId);
      const settled: SettleResult = {
        success: true,
        payer: hold.payer,
        transaction: hold.createTxId,
        network: HEDERA_TESTNET,
      };
      // The link opens the execution, not the create; the enumeration stays as it was.
      Object.defineProperty(settled, "explorerRef", { value: record.consensusTimestamp, enumerable: false });
      return settled;
    },

    async refund(jobId) {
      return dropHold(jobId);
    },

    async cancel(jobId, _sellerSig) {
      return dropHold(jobId);
    },

    async status(jobId) {
      const hold = holds.get(jobId);
      if (!hold) return "none";
      const schedule = await getSchedule(hold.scheduleId, mirror);
      if (!schedule) return "refunded";
      if (schedule.executedTimestamp) return "released";
      if (schedule.deleted) return "refunded";
      const expires = secondsOf(schedule.expirationTime);
      if (expires !== null && now() >= expires) return "refunded";
      return "funded";
    },
  };

  const rail: HeldRail = {
    declaration: HEDERA_SCHEDULED_DECLARATION,

    challenge(offer: Offer, _ctx: ChallengeContext): PaymentRequirements {
      const payTo = offer.payTo?.["hedera-scheduled"];
      if (!payTo || !ACCOUNT_ID.test(payTo)) throw new Error("offer has no hedera-scheduled payTo");
      return {
        scheme: "countersign",
        network: HEDERA_TESTNET,
        amount: offer.price,
        asset: USDC_TESTNET,
        payTo,
        maxTimeoutSeconds: offer.deadline,
        extra: {
          name: "hedera-scheduled",
          offerHash: offerHash(offer),
          holdSeconds: offer.deadline + 180,
        },
      };
    },

    async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
      if (!isRecord(payment.payload)) return invalid("malformed");
      const scheduleId = payment.payload.scheduleId;
      const createTxId = payment.payload.createTxId;
      if (
        typeof scheduleId !== "string" ||
        !ACCOUNT_ID.test(scheduleId) ||
        typeof createTxId !== "string" ||
        !TRANSACTION_ID.test(createTxId)
      ) {
        return invalid("malformed");
      }

      if (await seen.has(scheduleId)) return invalid("replay");
      if (!(await findCreate(scheduleId, createTxId))) return invalid("create_mismatch");

      const schedule = await findSchedule(scheduleId);
      if (!schedule) return invalid("schedule_not_found");
      if (schedule.deleted) return invalid("schedule_deleted");
      if (schedule.executedTimestamp) return invalid("schedule_executed");

      const expires = secondsOf(schedule.expirationTime);
      const at = now();
      if (expires !== null && at >= expires) return invalid("schedule_expired");
      if (schedule.waitForExpiry) return invalid("wait_for_expiry");
      if (schedule.adminKey !== null) return invalid("admin_key");
      if (expires === null) return invalid("hold_window");
      const remaining = expires - at;
      if (remaining < requirements.maxTimeoutSeconds + 60 || remaining > 3600) {
        return invalid("hold_window");
      }

      let check;
      try {
        const inspected = inspectScheduled(schedule.transactionBody);
        check = checkScheduledTransfer(inspected, {
          asset: requirements.asset,
          amount: BigInt(requirements.amount),
          payTo: requirements.payTo,
          offerHash: String(requirements.extra?.offerHash),
          payer: schedule.payer ?? "",
        });
      } catch (error) {
        return invalid(`mismatch: ${messageOf(error)}`);
      }
      if (!check.ok) return invalid(`mismatch: ${check.message}`);

      const payee = await readAccount(requirements.payTo);
      if (payee?.receiver_sig_required !== true) return invalid("payee_does_not_hold");

      const payer = schedule.payer;
      if (!payer) return invalid("unsupported_payer_key");
      const account = await readAccount(payer);
      const key = account && isRecord(account.key) ? account.key : null;
      const type = key?._type;
      if (type !== "ECDSA_SECP256K1" && type !== "ED25519") return invalid("unsupported_payer_key");
      if (typeof key?.key !== "string") return invalid("unsupported_payer_key");

      const keyBytes = Buffer.from(key.key, "hex");
      const signed = schedule.signatures.some((entry) => {
        if (!isRecord(entry) || typeof entry.public_key_prefix !== "string") return false;
        const prefix = Buffer.from(entry.public_key_prefix, "base64");
        return (
          prefix.length >= 4 &&
          prefix.length <= keyBytes.length &&
          keyBytes.subarray(0, prefix.length).equals(prefix)
        );
      });
      if (!signed) return invalid("payer_not_signed");

      verifiedPayer.set(scheduleId, payer);
      return { isValid: true, payer };
    },

    async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
      if (!isRecord(payment.payload)) return fail("malformed");
      const scheduleId = payment.payload.scheduleId;
      const createTxId = payment.payload.createTxId;
      if (
        typeof scheduleId !== "string" ||
        !ACCOUNT_ID.test(scheduleId) ||
        typeof createTxId !== "string" ||
        !TRANSACTION_ID.test(createTxId)
      ) {
        return fail("malformed");
      }
      if (!(await seen.claim(scheduleId))) return fail("replay");

      const payer = verifiedPayer.get(scheduleId) ?? (await getSchedule(scheduleId, mirror))?.payer ?? "";
      holds.set(heldJobId(createTxId), {
        scheduleId,
        createTxId,
        payTo: requirements.payTo,
        asset: requirements.asset,
        amount: requirements.amount,
        payer,
      });
      return { success: true, payer, transaction: createTxId, network: HEDERA_TESTNET };
    },

    escrow,
  };

  return rail;
}
