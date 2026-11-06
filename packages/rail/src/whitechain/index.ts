/**
 * The whitechain rail: the escrow rail with Whitechain Sepolia's configuration (USDT, chain 1874).
 * Challenge and status come from the wrapped escrow rail. Verify, settle, release, cancel and
 * refund go to the relay over HTTP; the relay is the x402 facilitator and pays the gas.
 * This module never imports the relay.
 */

import { getAddress, type Address, type Chain, type Hex, type PublicClient, type Transport } from "viem";
import type { Network, PaymentPayload, PaymentRequirements, SettleResult, VerifyResult } from "@countersign/core";
import type { EscrowOps, Rail } from "../rail.ts";
import { escrowRail } from "../escrow/index.ts";

export const WHITECHAIN_USDT: Address = getAddress("0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
export const WHITECHAIN_ESCROW: Address = getAddress("0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4");
export const WHITECHAIN_RPC_URL = "https://rpc.ankr.com/whitechain_testnet";
const NETWORK: Network = "eip155:1874";

export interface WhitechainRailOptions {
  /** Base URL of the relay, without a trailing slash. */
  relayUrl: string;
  rpcUrl?: string;
  /** Escrow contract version. Version 2 requires `escrow`; default 1, the deployed v1 escrow. */
  version?: 1 | 2;
  /** Version 2 only: the deployed escrow. Version 1 defaults to WHITECHAIN_ESCROW. */
  escrow?: Address;
  /** Version 2 only: the bearer token the relay requires on /escrow/fail. */
  relayToken?: string;
  /** Version 2 only: the relay's submitting address. A bonded job's Lock(jobId, funder) must name it. */
  funder?: Address;
  fetch?: typeof fetch;
  publicClient?: PublicClient<Transport, Chain>;
}

export function whitechainRail(opts: WhitechainRailOptions): Rail {
  const call = opts.fetch ?? globalThis.fetch;
  const relayUrl = opts.relayUrl.replace(/\/+$/, "");
  const version = opts.version ?? 1;
  if (version === 2 && !opts.escrow) throw new Error("whitechain escrow v2 needs its escrow address");
  // On v2 the relay acts on the hub's word for its funder and arbiter powers: a bonded fund and a
  // late release both carry the hub's bearer token.
  const hubToken = version === 2 ? opts.relayToken?.trim() || undefined : undefined;
  const escrowAddress = opts.escrow ?? WHITECHAIN_ESCROW;
  const base = escrowRail({
    id: "whitechain",
    chainId: 1874,
    rpcUrl: opts.rpcUrl ?? WHITECHAIN_RPC_URL,
    escrow: escrowAddress,
    ...(version === 2 ? { version: 2 as const } : {}),
    token: WHITECHAIN_USDT,
    tokenName: "Tether USD",
    tokenVersion: "1",
    symbol: "USDT",
    decimals: 6,
    explorerTx: "https://explorer.testnet.whitechain.io/tx/{tx}",
    finality: "Final one Whitechain block, about a second, after release.",
    gasPaidBy: "relayer",
    finalitySeconds: 6,
    cost: { tollBps: 100, fixed: "0" },
    ...(opts.publicClient ? { publicClient: opts.publicClient } : {}),
  });

  /** POST JSON to the relay. Null when the relay is unreachable or does not answer with JSON. */
  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await call(`${relayUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  const unreachable = (): SettleResult => ({
    success: false,
    errorReason: "relay_unreachable",
    transaction: "",
    network: NETWORK,
  });

  async function verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResult> {
    const out = await post("/verify", { x402Version: 2, paymentPayload, paymentRequirements });
    if (!out || typeof out.isValid !== "boolean") return { isValid: false, invalidReason: "relay_unreachable" };
    return out as unknown as VerifyResult;
  }

  async function settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    opts?: { lockSig?: Hex },
  ): Promise<SettleResult> {
    const out = await post(
      "/settle",
      {
        x402Version: 2,
        paymentPayload,
        paymentRequirements,
        ...(opts?.lockSig ? { lockSig: opts.lockSig } : {}),
      },
      opts?.lockSig && hubToken ? { authorization: `Bearer ${hubToken}` } : {},
    );
    if (!out || typeof out.success !== "boolean") return unreachable();
    return out as unknown as SettleResult;
  }

  /** The relay answers { ok, transaction, url, status } or { ok: false, reason }. */
  async function close(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<SettleResult> {
    const out = await post(path, body, headers);
    if (!out) return unreachable();
    if (out.ok === true && typeof out.transaction === "string") {
      return { success: true, transaction: out.transaction, network: NETWORK };
    }
    return {
      success: false,
      errorReason: typeof out.reason === "string" ? out.reason : "relay_unreachable",
      transaction: "",
      network: NETWORK,
    };
  }

  const escrow: EscrowOps = {
    release: (jobId: Hex, slipHash: Hex, sellerSig: Hex) => close("/escrow/release", { jobId, slipHash, sellerSig }),
    cancel: (jobId: Hex, sellerSig: Hex) => close("/escrow/cancel", { jobId, sellerSig }),
    refund: (jobId: Hex) => close("/escrow/refund", { jobId }),
    status: base.escrow!.status,
  };

  if (version === 2) {
    const token = opts.relayToken?.trim();
    escrow.accept = (jobId, buyerSig) => close("/escrow/accept", { jobId, buyerSig });
    escrow.dispute = (jobId, status, buyerSig) =>
      close("/escrow/dispute", { jobId, status, buyerSig });
    escrow.releaseAfterWindow = (jobId) => close("/escrow/release-after-window", { jobId });
    if (token) {
      // Past the deadline the relay releases only on the hub's word, so the hub's release carries it.
      escrow.release = (jobId, slipHash, sellerSig) =>
        close("/escrow/release", { jobId, slipHash, sellerSig }, { authorization: `Bearer ${token}` });
      escrow.failDelivery = (jobId) =>
        close("/escrow/fail", { jobId }, { authorization: `Bearer ${token}` });
    }
    escrow.reviewOf = base.escrow!.reviewOf;
    escrow.tollBps = base.escrow!.tollBps;
    escrow.disputeWindowSeconds = base.escrow!.disputeWindowSeconds;
  }

  const funder = version === 2 && opts.funder ? getAddress(opts.funder) : undefined;
  return {
    declaration: base.declaration,
    challenge: base.challenge,
    verify,
    settle,
    escrow,
    ...(funder ? { funder } : {}),
  };
}
