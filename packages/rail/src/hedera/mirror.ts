// Read-only mirror node queries. The mirror node trails consensus by a few seconds,
// so callers that just submitted a transaction should use waitForTransaction.
import { MIRROR_TESTNET } from "./constants.ts";
import { toMirrorTxId } from "./txid.ts";

export class MirrorError extends Error {
  override name = "MirrorError";
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`mirror ${path} -> ${status}`);
  }
}

export interface MirrorOptions {
  base?: string;
  fetch?: typeof fetch;
}

export interface GetTransactionOptions extends MirrorOptions {
  /** Read the record of a scheduled execution rather than the schedule create itself. */
  scheduled?: boolean;
}

async function get<T>(path: string, opts: MirrorOptions = {}): Promise<T | null> {
  const f = opts.fetch ?? fetch;
  const r = await f((opts.base ?? MIRROR_TESTNET) + path);
  if (r.status === 404) return null;
  if (!r.ok) throw new MirrorError(path, r.status);
  return (await r.json()) as T;
}

/** The account id that owns an EVM alias or account id, or null if no such account exists yet. */
export async function resolveAccount(idOrEvm: string, opts?: MirrorOptions): Promise<string | null> {
  const d = await get<{ account?: string }>(`/api/v1/accounts/${idOrEvm}`, opts);
  return d?.account ?? null;
}

export async function hbarBalance(accountId: string, opts?: MirrorOptions): Promise<bigint> {
  const d = await get<{ balance?: { balance?: number | string } }>(`/api/v1/accounts/${accountId}`, opts);
  if (!d) throw new MirrorError(`/api/v1/accounts/${accountId}`, 404);
  return BigInt(d.balance?.balance ?? 0);
}

/** Token balance in smallest units, or null when the account is not associated with the token. */
export async function tokenBalance(accountId: string, tokenId: string, opts?: MirrorOptions): Promise<bigint | null> {
  const d = await get<{ tokens: { token_id: string; balance: number | string }[] }>(
    `/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`,
    opts,
  );
  const row = d?.tokens.find((t) => t.token_id === tokenId);
  return row ? BigInt(row.balance) : null;
}

export interface MirrorTransfer {
  account: string;
  amount: bigint;
}

export interface MirrorTransaction {
  id: string;
  result: string;
  name: string;
  consensusTimestamp: string;
  memo: string;
  hbar: MirrorTransfer[];
  tokens: Record<string, MirrorTransfer[]>;
}

interface RawTransaction {
  transaction_id: string;
  result: string;
  name: string;
  consensus_timestamp: string;
  memo_base64?: string | null;
  transfers?: { account: string; amount: number | string }[];
  token_transfers?: { token_id: string; account: string; amount: number | string }[];
}

export function normalizeTransaction(raw: RawTransaction): MirrorTransaction {
  const tokens: Record<string, MirrorTransfer[]> = {};
  for (const t of raw.token_transfers ?? []) {
    (tokens[t.token_id] ??= []).push({ account: t.account, amount: BigInt(t.amount) });
  }
  return {
    id: raw.transaction_id,
    result: raw.result,
    name: raw.name,
    consensusTimestamp: raw.consensus_timestamp,
    memo: raw.memo_base64 ? Buffer.from(raw.memo_base64, "base64").toString("utf8") : "",
    hbar: (raw.transfers ?? []).map((t) => ({ account: t.account, amount: BigInt(t.amount) })),
    tokens,
  };
}

/** The first record of a transaction id, or null if unseen. `scheduled` reads the executed child record. */
export async function getTransaction(txId: string, opts: GetTransactionOptions = {}): Promise<MirrorTransaction | null> {
  const suffix = opts.scheduled ? "?scheduled=true" : "";
  const d = await get<{ transactions: RawTransaction[] }>(`/api/v1/transactions/${toMirrorTxId(txId)}${suffix}`, opts);
  const first = d?.transactions[0];
  return first ? normalizeTransaction(first) : null;
}

export async function waitForTransaction(
  txId: string,
  opts: MirrorOptions & { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MirrorTransaction> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  for (;;) {
    const tx = await getTransaction(txId, opts);
    if (tx) return tx;
    if (Date.now() > deadline) throw new Error(`transaction ${txId} not on the mirror node after ${opts.timeoutMs ?? 30_000}ms`);
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 1_500));
  }
}

/** Net amount credited to an account in a transfer list (negative when it paid). */
export function netFor(transfers: MirrorTransfer[], account: string): bigint {
  return transfers.filter((t) => t.account === account).reduce((s, t) => s + t.amount, 0n);
}
