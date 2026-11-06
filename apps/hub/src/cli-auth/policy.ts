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
const MESSAGES = /^countersign (runner|offer|delist|canary) [0-9A-Za-z: x-]{1,200}$/;

export type Verdict = { ok: true } | { ok: false; reason: string };

export function checkTypedData(typed: TypedDataInput, ctx: SignContext): Verdict {
  const chainId = Number(typed.domain.chainId);
  const contract = String(typed.domain.verifyingContract ?? "").toLowerCase();
  if (typed.primaryType === "ReceiveWithAuthorization") {
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
    if (!ctx.escrows.some((e) => e.chainId === chainId && e.escrow === contract)) return { ok: false, reason: "escrow" };
    const keys = Object.keys(typed.message).sort().join(",");
    if (keys !== "jobId,slipHash") return { ok: false, reason: "shape" };
    return { ok: true };
  }
  return { ok: false, reason: "type" };
}

export function checkMessage(message: string): Verdict {
  return MESSAGES.test(message) ? { ok: true } : { ok: false, reason: "message" };
}
