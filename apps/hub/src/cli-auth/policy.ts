import type { TypedDataInput } from "../wallets/privy-wallets.ts";

export interface KnownEscrow { chainId: number; escrow: string }
export interface SignContext {
  address: string;               // the session's wallet, lowercase
  escrows: KnownEscrow[];        // escrows this hub runs, lowercase
  maxValue: bigint;              // the cap for one buyer authorization
}

const TOKENS: Array<{ chainId: number; token: string }> = [
  { chainId: 5042002, token: "0x3600000000000000000000000000000000000000" },
  { chainId: 1874, token: "0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7" },
];
export const HARD_CAP = 1_000_000n; // 1 USDC or USDT per signature tonight
const MESSAGES =
  /^countersign (?:runner [0-9a-f]{32}|offer 0x[0-9a-fA-F]{64}|delist 0x[0-9a-fA-F]{64}|canary 0x[0-9a-fA-F]{64} 0x[0-9a-fA-F]{32})$/;

const RECEIVE_FIELDS = [["from", "address"], ["to", "address"], ["value", "uint256"], ["validAfter", "uint256"], ["validBefore", "uint256"], ["nonce", "bytes32"]];
const RELEASE_FIELDS = [["jobId", "bytes32"], ["slipHash", "bytes32"]];
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
function sameFields(fields: Array<{ name: string; type: string }> | undefined, want: string[][]): boolean {
  return Array.isArray(fields) && fields.length === want.length && fields.every((f, i) => f.name === want[i]?.[0] && f.type === want[i]?.[1]);
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function checkTypedData(typed: TypedDataInput, ctx: SignContext): Verdict {
  const chainId = Number(typed.domain.chainId);
  const contract = String(typed.domain.verifyingContract ?? "").toLowerCase();
  if (typed.primaryType === "ReceiveWithAuthorization") {
    if (!sameFields(typed.types.ReceiveWithAuthorization, RECEIVE_FIELDS)) return { ok: false, reason: "shape" };
    if (!TOKENS.some((t) => t.chainId === chainId && t.token === contract)) return { ok: false, reason: "token" };
    const from = String(typed.message.from ?? "").toLowerCase();
    const to = String(typed.message.to ?? "").toLowerCase();
    if (from !== ctx.address) return { ok: false, reason: "from" };
    if (!ctx.escrows.some((e) => e.chainId === chainId && e.escrow === to)) return { ok: false, reason: "escrow" };
    let value: bigint;
    try { value = BigInt(String(typed.message.value)); } catch { return { ok: false, reason: "value" }; }
    if (value <= 0n || value > ctx.maxValue || value > HARD_CAP) return { ok: false, reason: "value" };
    return { ok: true };
  }
  if (typed.primaryType === "Release") {
    if (!sameFields(typed.types.Release, RELEASE_FIELDS)) return { ok: false, reason: "shape" };
    const keys = Object.keys(typed.message).sort().join(",");
    if (keys !== "jobId,slipHash") return { ok: false, reason: "shape" };
    if (!BYTES32.test(String(typed.message.jobId)) || !BYTES32.test(String(typed.message.slipHash))) return { ok: false, reason: "shape" };
    if (typed.domain.name !== "Countersign" || typed.domain.version !== "1") return { ok: false, reason: "domain" };
    const domainKeys = Object.keys(typed.domain).sort().join(",");
    if (domainKeys === "name,version") return { ok: true }; // a slip on a rail without an escrow
    if (domainKeys !== "chainId,name,verifyingContract,version") return { ok: false, reason: "domain" };
    if (!ctx.escrows.some((e) => e.chainId === chainId && e.escrow === contract)) return { ok: false, reason: "escrow" };
    return { ok: true };
  }
  return { ok: false, reason: "type" };
}

export function checkMessage(message: string): Verdict {
  return MESSAGES.test(message) ? { ok: true } : { ok: false, reason: "message" };
}
