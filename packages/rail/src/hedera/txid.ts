// Hedera transaction ids: "0.0.123@1700000000.000000042" (SDK and x402 form)
// and "0.0.123-1700000000-000000042" (mirror node REST form).
import { HASHSCAN_TESTNET } from "./constants.ts";

const SDK_FORM = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/;
const MIRROR_FORM = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/;

export interface ParsedTxId {
  payer: string;
  seconds: string;
  nanos: string;
}

export function parseTxId(id: string): ParsedTxId {
  const m = id.match(SDK_FORM) ?? id.match(MIRROR_FORM);
  if (!m) throw new Error(`not a Hedera transaction id: ${JSON.stringify(id)}`);
  return { payer: m[1]!, seconds: m[2]!, nanos: m[3]!.padStart(9, "0") };
}

export function toMirrorTxId(id: string): string {
  const p = parseTxId(id);
  return `${p.payer}-${p.seconds}-${p.nanos}`;
}

export function toSdkTxId(id: string): string {
  const p = parseTxId(id);
  return `${p.payer}@${p.seconds}.${p.nanos}`;
}

/** HashScan resolves the SDK form of a transaction id directly. */
export function hashscanTx(id: string): string {
  return `${HASHSCAN_TESTNET}/transaction/${toSdkTxId(id)}`;
}

export function hashscanAccount(accountId: string): string {
  return `${HASHSCAN_TESTNET}/account/${accountId}`;
}

export function hashscanTopic(topicId: string): string {
  return `${HASHSCAN_TESTNET}/topic/${topicId}`;
}
