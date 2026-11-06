// The agent's spending log on Hedera Consensus Service. Every spend, and every spend the envelope
// refused, is one message on a topic whose only submit key is the agent's and which has no admin
// key, so entries can be added but never edited, reordered or deleted. Anyone can replay the topic
// from the mirror node and match each spend to its transfer, and any agent transfer missing from
// the log shows up too.
import { canonicalJson, type EnvelopeRefusal } from "@countersign/core";
import {
  getTransaction,
  MIRROR_TESTNET,
  mirrorFetch,
  netFor,
  offerHashFromMemo,
  scheduleStatus,
  toSdkTxId,
  type MirrorOptions,
  type MirrorTransaction,
} from "@countersign/rail/hedera";
import { type Client, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

export interface SpendEntry {
  v: 1;
  kind: "spend" | "refused" | "schedule" | "expired";
  rail: "hedera";
  network: "hedera:testnet";
  offerHash: string;
  /** The seller's identity key from the offer. */
  seller: string;
  /** The Hedera account paid. */
  payTo: string;
  asset: string;
  /** Atomic units of `asset`. */
  amount: string;
  /** Hedera transaction id of the payment, or the schedule create transaction; spends/schedules only. */
  tx?: string;
  /** Schedule id when the spend was a scheduled transfer; `tx` is then the create transaction id. */
  schedule?: string;
  /** Unix seconds when the schedule stops being executable; schedule entries only. */
  expiresAt?: number;
  /** Why the envelope said no; refusals only. */
  reason?: EnvelopeRefusal | string;
  /** Running total under the envelope after this entry, atomic. */
  total: string;
  /** The envelope's cap, atomic. */
  cap: string;
  /** Unix seconds when the agent wrote it. */
  at: number;
}

export interface LoggedEntry {
  sequence: number;
  /** Consensus timestamp "seconds.nanos": the network's clock, not the agent's. */
  consensusAt: string;
  entry: SpendEntry;
}

export interface Appended {
  sequence: number;
  transactionId: string;
}

/** HCS takes up to 1024 bytes in one message; a spend entry is about 400. */
const MAX_MESSAGE_BYTES = 1024;

/** Append one entry. `client` must have the agent as operator: the topic's submit key is the agent's. */
export async function appendEntry(client: Client, topicId: string, entry: SpendEntry): Promise<Appended> {
  const message = canonicalJson(entry);
  if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) throw new Error("spend entry exceeds one HCS message");
  const response = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(message).execute(client);
  const receipt = await response.getReceipt(client);
  return { sequence: Number(receipt.topicSequenceNumber?.toString() ?? 0), transactionId: response.transactionId.toString() };
}

function parseEntry(raw: unknown): SpendEntry | null {
  const e = raw as Partial<SpendEntry> | null;
  if (
    !e ||
    e.v !== 1 ||
    (e.kind !== "spend" && e.kind !== "refused" && e.kind !== "schedule" && e.kind !== "expired") ||
    e.rail !== "hedera"
  ) {
    return null;
  }
  for (const k of ["offerHash", "seller", "payTo", "asset", "amount", "total", "cap"] as const) {
    if (typeof e[k] !== "string") return null;
  }
  if (e.kind === "spend" && typeof e.tx !== "string") return null;
  if (e.schedule !== undefined && typeof e.schedule !== "string") return null;
  if (e.expiresAt !== undefined && (typeof e.expiresAt !== "number" || !Number.isFinite(e.expiresAt))) return null;
  if (e.kind === "schedule" || e.kind === "expired") {
    if (typeof e.tx !== "string" || typeof e.schedule !== "string") return null;
  }
  if (e.kind === "schedule" && typeof e.expiresAt !== "number") return null;
  return e as SpendEntry;
}

/** Every entry on the topic in consensus order. Messages that are not spend entries are skipped. */
export async function readEntries(topicId: string, opts: MirrorOptions = {}): Promise<LoggedEntry[]> {
  const base = opts.base ?? MIRROR_TESTNET;
  const out: LoggedEntry[] = [];
  let next: string | null = `/api/v1/topics/${topicId}/messages?order=asc&limit=100`;
  while (next) {
    const r = await mirrorFetch(base + next, opts);
    if (r.status === 404) return out;
    if (!r.ok) throw new Error(`mirror topic ${topicId} -> ${r.status}`);
    const page = (await r.json()) as {
      messages: { sequence_number: number; consensus_timestamp: string; message: string }[];
      links?: { next?: string | null };
    };
    for (const m of page.messages) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
      } catch {
        continue;
      }
      const entry = parseEntry(parsed);
      if (entry) out.push({ sequence: m.sequence_number, consensusAt: m.consensus_timestamp, entry });
    }
    next = page.links?.next ?? null;
  }
  return out;
}

export interface Reconciliation {
  /** Spends whose transaction moved exactly that amount from the agent to that payee, for that offer. */
  matched: LoggedEntry[];
  /** Spends the chain does not back: missing, failed, or different from what was logged. */
  unbacked: { logged: LoggedEntry; why: string }[];
  /** Successful agent transfers of the asset that no spend entry mentions. */
  unlogged: string[];
  /** Schedules whose create is logged and that are still pending on the mirror. */
  pending: LoggedEntry[];
  /** Schedules logged at create that expired or were deleted without executing. */
  released: LoggedEntry[];
}

function executionProblem(tx: MirrorTransaction, entry: SpendEntry, agent: string): string | null {
  const moved = tx.tokens[entry.asset] ?? [];
  return tx.result !== "SUCCESS"
    ? `result ${tx.result}`
    : netFor(moved, entry.payTo) !== BigInt(entry.amount)
      ? "payee credit differs"
      : netFor(moved, agent) !== -BigInt(entry.amount)
        ? "agent debit differs"
        : offerHashFromMemo(tx.memo) !== entry.offerHash.toLowerCase()
          ? "memo names another offer"
          : null;
}

/**
 * Match the log against the chain. `agent` is the paying account; `asset` the token it pays in.
 * Only outgoing transfers of `asset` count toward `unlogged`, so the HCS fees themselves do not.
 * The omission check starts at `since` (consensus "seconds.nanos"), by default the first entry:
 * transfers made before the agent began logging are outside what the log promises.
 */
export async function reconcile(
  entries: LoggedEntry[],
  agent: string,
  asset: string,
  opts: MirrorOptions & { since?: string } = {},
): Promise<Reconciliation> {
  const matched: LoggedEntry[] = [];
  const unbacked: Reconciliation["unbacked"] = [];
  const pending: LoggedEntry[] = [];
  const released: LoggedEntry[] = [];
  const loggedTx = new Set<string>();
  for (const logged of entries) {
    const e = logged.entry;

    if (e.kind === "spend") {
      if (!e.tx) continue;
      loggedTx.add(toSdkTxId(e.tx));
      const scheduled = typeof e.schedule === "string";
      const tx = await getTransaction(e.tx, { ...opts, scheduled }).catch(() => null);
      if (!tx) {
        unbacked.push({ logged, why: scheduled ? "scheduled execution not found" : "transaction not found" });
        continue;
      }
      // A scheduled transfer executes under its own transaction id; both ids are backed by this entry.
      if (scheduled) loggedTx.add(toSdkTxId(tx.id));
      const why = executionProblem(tx, e, agent);
      if (why) unbacked.push({ logged, why });
      else matched.push(logged);
      continue;
    }

    if (e.kind === "schedule") {
      if (!e.tx || !e.schedule) continue;
      loggedTx.add(toSdkTxId(e.tx));
      const tx = await getTransaction(e.tx, { ...opts, scheduled: true }).catch(() => null);
      if (tx) {
        // The create id and the execution id both point at this one logged schedule.
        loggedTx.add(toSdkTxId(tx.id));
        const why = executionProblem(tx, e, agent);
        if (why) unbacked.push({ logged, why });
        else matched.push(logged);
        continue;
      }
      const status = await scheduleStatus(e.schedule, opts);
      if (status === "pending") pending.push(logged);
      else if (status === "expired" || status === "deleted") released.push(logged);
      else unbacked.push({ logged, why: "scheduled execution not found" });
      continue;
    }

    if (e.kind === "expired") {
      if (!e.tx || !e.schedule) continue;
      loggedTx.add(toSdkTxId(e.tx));
      const tx = await getTransaction(e.tx, { ...opts, scheduled: true }).catch(() => null);
      if (tx) loggedTx.add(toSdkTxId(tx.id));
      const status = await scheduleStatus(e.schedule, opts);
      if (tx || status === "executed") {
        unbacked.push({ logged, why: "logged as expired, but the schedule executed" });
      } else if (status === "pending") {
        unbacked.push({ logged, why: "logged as expired, but the schedule is still pending" });
      }
    }
  }

  const base = opts.base ?? MIRROR_TESTNET;
  const unlogged: string[] = [];
  const since = opts.since ?? entries[0]?.consensusAt;
  if (!since) return { matched, unbacked, unlogged, pending, released };
  let next: string | null =
    `/api/v1/transactions?account.id=${agent}&transactiontype=CRYPTOTRANSFER&result=success&order=asc&limit=100` +
    `&timestamp=gte:${since}`;
  while (next) {
    const r = await mirrorFetch(base + next, opts);
    if (!r.ok) throw new Error(`mirror transactions for ${agent} -> ${r.status}`);
    const page = (await r.json()) as {
      transactions: { transaction_id: string; token_transfers?: { token_id: string; account: string; amount: number }[] }[];
      links?: { next?: string | null };
    };
    for (const t of page.transactions) {
      const out = (t.token_transfers ?? []).some((x) => x.token_id === asset && x.account === agent && x.amount < 0);
      if (!out) continue;
      const sdkId = toSdkTxId(t.transaction_id);
      if (!loggedTx.has(sdkId)) unlogged.push(sdkId);
    }
    next = page.links?.next ?? null;
  }
  return { matched, unbacked, unlogged, pending, released };
}
