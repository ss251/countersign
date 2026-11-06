/**
 * Hedera reads for the suite, written here on purpose: the checks must not lean on the
 * product's own mirror helpers, or a bug in them would hide itself.
 */

import { HEDERA } from "./chains.ts";
import { sleep } from "./http.ts";

/** "0.0.123@1730880000.123456789" or "0.0.123-1730880000-123456789" -> the mirror's dash form. */
export function mirrorTxId(id: string): string {
  const at = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id);
  if (at) return `${at[1]}-${at[2]}-${at[3]}`;
  if (/^\d+\.\d+\.\d+-\d+-\d+$/.test(id)) return id;
  throw new Error(`not a Hedera transaction id: ${id}`);
}

/** The SDK's at form, which HashScan links use. */
export function sdkTxId(id: string): string {
  const m = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1]}@${m[2]}.${m[3]}` : id;
}

export interface MirrorTx {
  result: string;
  memo: string;
  tokenTransfers: { token_id: string; account: string; amount: number }[];
  consensusTimestamp: string;
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${HEDERA.mirror}${path}`, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** The transaction as the mirror node has it, waiting for it to appear. */
export async function mirrorTransaction(id: string, timeoutMs = 60_000): Promise<MirrorTx> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const { status, body } = await getJson(`/api/v1/transactions/${mirrorTxId(id)}`);
    const txs = (body as { transactions?: Array<Record<string, unknown>> }).transactions;
    if (status === 200 && Array.isArray(txs) && txs.length > 0) {
      const t = txs[0] as { result: string; memo_base64?: string; token_transfers?: MirrorTx["tokenTransfers"]; consensus_timestamp: string };
      return {
        result: t.result,
        memo: t.memo_base64 ? Buffer.from(t.memo_base64, "base64").toString("utf8") : "",
        tokenTransfers: t.token_transfers ?? [],
        consensusTimestamp: t.consensus_timestamp,
      };
    }
    if (Date.now() > until) throw new Error(`the mirror node has no transaction ${id} after ${timeoutMs / 1000} s (last status ${status})`);
    await sleep(3000);
  }
}

export interface TopicMessage {
  sequence: number;
  consensusTimestamp: string;
  payerAccount: string;
  json: unknown;
}

/** One topic message by sequence number, waiting for it to appear. */
export async function topicMessage(topicId: string, sequence: number, timeoutMs = 60_000): Promise<TopicMessage> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const { status, body } = await getJson(`/api/v1/topics/${topicId}/messages/${sequence}`);
    if (status === 200) {
      const m = body as { sequence_number: number; consensus_timestamp: string; payer_account_id: string; message: string };
      const text = Buffer.from(m.message, "base64").toString("utf8");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { sequence: m.sequence_number, consensusTimestamp: m.consensus_timestamp, payerAccount: m.payer_account_id, json };
    }
    if (Date.now() > until) throw new Error(`the mirror node has no message ${sequence} on topic ${topicId} after ${timeoutMs / 1000} s (last status ${status})`);
    await sleep(3000);
  }
}

/** Net movement of one token for one account in a transaction. */
export function netToken(tx: MirrorTx, token: string, account: string): bigint {
  return tx.tokenTransfers
    .filter((t) => t.token_id === token && t.account === account)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}

export function hashscanTx(id: string): string {
  return `${HEDERA.hashscan}/transaction/${sdkTxId(id)}`;
}

export function hashscanTopic(topicId: string): string {
  return `${HEDERA.hashscan}/topic/${topicId}`;
}
