import { getAddress, isAddress } from "viem";
import type { Address, Chain, Hex, PublicClient, Transport } from "viem";
import { escrowRail, escrowV2Abi } from "@countersign/rail";
import { parseAtomic } from "@countersign/core";
import type { CountersignExtra, CountersignPayload, SettleResult, VerifyResult } from "@countersign/core";
import { NETWORK } from "./chain.ts";
import { readNow, resourceDescription } from "./exact.ts";
import type { ExactClock } from "./exact.ts";
import type { Ledger } from "./ledger.ts";
import type { ChainReader } from "./ports.ts";
import { reconcilePendingJob } from "./reconcile.ts";
import type { EscrowFundCall, Relayer, RelayRefusalReason } from "./relayer.ts";
import { whitechainEscrowConfig } from "./whitechain-config.ts";

export type CountersignContext = {
  /** Handed to escrowRail as its publicClient. Only readContract is used. */
  chainClient: unknown;
  reader: ChainReader;
  relayer: Relayer;
  ledger: Ledger;
  now: ExactClock;
};

export type CountersignSettleResponse = SettleResult & { jobId?: string };

type Body = {
  x402Version: number;
  paymentPayload: {
    accepted: Record<string, unknown>;
    payload: Record<string, unknown>;
    resource?: unknown;
  } & Record<string, unknown>;
  paymentRequirements: Record<string, unknown> & { extra?: Record<string, unknown> };
  /** Escrow v2: the payee's Lock(jobId) signature, beside the payment. */
  lockSig?: unknown;
};

type Checked =
  | { ok: false; result: VerifyResult }
  | {
      ok: true;
      body: Body;
      payload: CountersignPayload;
      extra: CountersignExtra;
      payer: Address;
      version: 1 | 2;
    };

function railFor(ctx: CountersignContext, escrow: Address, version: 1 | 2) {
  const now = ctx.now;
  return escrowRail(
    whitechainEscrowConfig({
      escrow,
      ...(version === 2 ? { version: 2 as const } : {}),
      publicClient: ctx.chainClient as PublicClient<Transport, Chain>,
      now: () => readNow(now),
    }),
  );
}

function invalid(reason: string): { ok: false; result: VerifyResult } {
  return { ok: false, result: { isValid: false, invalidReason: reason } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function isHexString(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

export function fundCall(
  extra: CountersignExtra,
  payload: CountersignPayload,
  version: 1 | 2 = 1,
  lockSig?: Hex,
): EscrowFundCall {
  return {
    kind: "escrowFund",
    escrow: getAddress(extra.escrow),
    offerHash: extra.offerHash,
    payload,
    version,
    ...(lockSig ? { lockSig } : {}),
  };
}

/** The bond the terms countersigned, in atomic units; zero when absent or malformed. */
function bondOfTerms(payload: CountersignPayload): bigint {
  const bond = payload.terms.bond;
  return typeof bond === "string" && /^\d+$/.test(bond) ? BigInt(bond) : 0n;
}

async function check(input: unknown, ctx: CountersignContext, allowedEscrows: Address[]): Promise<Checked> {
  const body = input as Body | null | undefined;
  if (!isObject(body) || body.x402Version !== 2) return invalid("invalid_payload");
  const payment = body.paymentPayload;
  const req = body.paymentRequirements;
  if (!isObject(payment) || !isObject(req)) return invalid("invalid_payload");
  if (!isObject(payment.accepted) || !isObject(payment.payload)) return invalid("invalid_payload");
  if (req.scheme !== "countersign") return invalid("invalid_scheme");
  if (req.network !== NETWORK) return invalid("invalid_network");
  const extra = req.extra;
  if (!isObject(extra) || typeof extra.escrow !== "string" || !isAddress(extra.escrow)) {
    return invalid("invalid_payload");
  }
  if (!allowedEscrows.some((escrow) => sameAddress(escrow, extra.escrow))) return invalid("invalid_payload");
  const escrow = getAddress(extra.escrow);
  const version = ctx.relayer.escrowVersion(escrow);
  const accepted = payment.accepted;
  if (
    accepted.scheme !== req.scheme ||
    accepted.network !== req.network ||
    accepted.amount !== req.amount ||
    !sameAddress(accepted.asset, req.asset) ||
    !sameAddress(accepted.payTo, req.payTo)
  ) {
    return invalid("invalid_payload");
  }

  if (typeof req.payTo !== "string" || !ctx.relayer.isAllowedPayee(req.payTo)) {
    return invalid("payee_not_registered");
  }
  let amount: bigint;
  try {
    if (typeof req.amount !== "string") return invalid("invalid_payload");
    amount = parseAtomic(req.amount);
  } catch {
    return invalid("invalid_payload");
  }
  if (amount < ctx.relayer.minAmount) return invalid("amount_below_minimum");

  const rail = railFor(ctx, escrow, version);
  let verdict: VerifyResult;
  try {
    verdict = await rail.verify(payment as never, req as never);
  } catch {
    return invalid("invalid_transaction_state");
  }
  if (!verdict.isValid || !verdict.payer) {
    return { ok: false, result: { isValid: false, invalidReason: verdict.invalidReason ?? "invalid_payload" } };
  }
  const payload = payment.payload as unknown as CountersignPayload;
  // The hub calls verify before the runner signs the Lock, so a bonded v2 job has none here.
  // Settle simulates with the real lockSig before submitting.
  if (!(version === 2 && bondOfTerms(payload) > 0n)) {
    const simulation = await ctx.relayer.simulate(
      fundCall(extra as unknown as CountersignExtra, payload, version, version === 2 ? "0x" : undefined),
    );
    if (!simulation.ok) return invalid("invalid_transaction_state");
  }
  return {
    ok: true,
    body,
    payload,
    extra: extra as unknown as CountersignExtra,
    payer: getAddress(verdict.payer),
    version,
  };
}

export function verifyCountersign(
  input: unknown,
  ctx: CountersignContext,
  allowedEscrows: Address[] = ctx.relayer.allowedEscrows,
): Promise<VerifyResult> {
  return check(input, ctx, allowedEscrows).then((checked) =>
    checked.ok ? { isValid: true, payer: checked.payer } : checked.result,
  );
}

export async function settleCountersign(
  input: unknown,
  ctx: CountersignContext,
  allowedEscrows: Address[] = ctx.relayer.allowedEscrows,
): Promise<CountersignSettleResponse> {
  const fail = (errorReason: string, extra: Partial<CountersignSettleResponse> = {}): CountersignSettleResponse => ({
    success: false,
    errorReason,
    transaction: "",
    network: NETWORK,
    ...extra,
  });

  const rawLockSig = (input as Body | null | undefined)?.lockSig;
  if (rawLockSig !== undefined && !isHexString(rawLockSig)) return fail("invalid_payload");
  const lockSig = rawLockSig as Hex | undefined;

  // A job already on the ledger answers without touching the chain again.
  const rawNonce = (input as Body | null)?.paymentPayload?.payload?.authorization as { nonce?: unknown } | undefined;
  if (typeof rawNonce?.nonce === "string") {
    const existing = ctx.ledger.getJob(rawNonce.nonce);
    if (existing) {
      if (existing.status === "pending") {
        if (await reconcilePendingJob(existing.jobId, ctx)) {
          return {
            success: true,
            payer: existing.buyer,
            transaction: existing.fundTx,
            network: NETWORK,
            jobId: existing.jobId,
          };
        }
        return fail("settlement_pending", { payer: existing.buyer, transaction: existing.fundTx, jobId: existing.jobId });
      }
      return {
        success: true,
        payer: existing.buyer,
        transaction: existing.fundTx,
        network: NETWORK,
        jobId: existing.jobId,
      };
    }
  }

  const checked = await check(input, ctx, allowedEscrows);
  if (!checked.ok) return fail(checked.result.invalidReason ?? "invalid_payload");

  const { payload, extra, payer, version } = checked;
  if (version === 2 && bondOfTerms(payload) > 0n && (!lockSig || lockSig === "0x")) {
    return fail("lock_missing", { payer });
  }
  const jobId = payload.authorization.nonce;
  const escrow = getAddress(extra.escrow);
  const outcome = await ctx.relayer.submit(fundCall(extra, payload, version, lockSig), payer);
  const terms = payload.terms;
  const resource = resourceUrl(checked.body.paymentPayload.resource);
  const description = resourceDescription(checked.body.paymentPayload.resource);
  const record = (status: "funded" | "pending", txHash: string, block: bigint, bond: string) =>
    ctx.ledger.recordJob({
      jobId,
      offerHash: terms.offerHash,
      buyer: getAddress(terms.buyer),
      payee: getAddress(terms.payee),
      amount: BigInt(terms.amount),
      deadline: terms.deadline,
      fundTx: txHash,
      fundBlock: block,
      status,
      escrow,
      bond,
      reviewWindow: version === 2 ? (terms.reviewWindow ?? 0) : undefined,
      createdAt: readNow(ctx.now) * 1000,
      resource,
      description,
    });

  switch (outcome.status) {
    case "confirmed": {
      const bond =
        version === 2
          ? await bondOfJob(ctx, escrow, jobId, terms.bond ?? "0")
          : "0";
      record("funded", outcome.txHash, outcome.blockNumber, bond);
      return { success: true, payer, transaction: outcome.txHash, network: NETWORK, jobId };
    }
    case "pending":
      record("pending", outcome.txHash, 0n, version === 2 ? (terms.bond ?? "0") : "0");
      return fail("settlement_pending", { payer, transaction: outcome.txHash, jobId });
    case "reverted":
      return fail("invalid_transaction_state", { payer, transaction: outcome.txHash });
    case "refused":
      return fail(refusalReason(outcome.reason), { payer });
  }
}

/** The bond the contract locked for this job, or the terms' value when the read is unavailable. */
async function bondOfJob(
  ctx: CountersignContext,
  escrow: Address,
  jobId: string,
  fallback: string,
): Promise<string> {
  try {
    const value = await ctx.reader.readContract({
      address: escrow,
      abi: escrowV2Abi,
      functionName: "bondOfJob",
      args: [jobId],
    });
    if (typeof value === "bigint") return value.toString(10);
    if (typeof value === "string" && /^\d+$/.test(value)) return value;
  } catch {
    // The fund landed; a failed read must not lose the job record.
  }
  return /^\d+$/.test(fallback) ? fallback : "0";
}

function refusalReason(reason: RelayRefusalReason): string {
  switch (reason) {
    case "simulation_failed":
      return "invalid_transaction_state";
    case "ceiling_wei":
    case "ceiling_tx":
    case "ceiling_payer":
      return "relay_ceiling_reached";
    case "balance_floor":
      return "relay_balance_low";
    case "fee_too_high":
      return "relay_fee_too_high";
    case "not_allowed":
      return "invalid_payload";
  }
}

function resourceUrl(resource: unknown): string | null {
  if (typeof resource === "string") return resource;
  if (isObject(resource) && typeof resource.url === "string") return resource.url;
  return null;
}
