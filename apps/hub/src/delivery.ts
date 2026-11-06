import {
  canonicalHash,
  canonicalJson,
  checkSchema,
  slipBodyFor,
  slipHash,
  slipSigner,
  type JobOrder,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResult,
  type SlipBody,
} from "./deps.ts";
import type { Rail } from "./deps.ts";
import type { Address, Hex } from "viem";
import type { DeliveredSlip } from "./runners.ts";
import { asNonce, isRecord, sameText } from "./util.ts";

interface BuildOrderInput {
  jobId: Hex;
  offerHash: Hex;
  input: unknown;
  railId: Rail["declaration"]["id"];
  network: Rail["declaration"]["network"];
  buyer: string;
  entry: PaymentRequirements;
  deadline: number;
  lineage: Hex[];
}

export function buildOrder(parts: BuildOrderInput): JobOrder {
  const order: JobOrder = {
    jobId: parts.jobId,
    offerHash: parts.offerHash,
    input: parts.input,
    rail: parts.railId,
    network: parts.network,
    buyer: parts.buyer,
    payTo: parts.entry.payTo,
    asset: parts.entry.asset,
    amount: parts.entry.amount,
    deadline: parts.deadline,
    lineage: parts.lineage,
  };
  const extra = isRecord(parts.entry.extra) ? parts.entry.extra : {};
  if (typeof extra.escrow === "string") order.escrow = extra.escrow as Address;
  if (typeof extra.chainId === "number" && Number.isSafeInteger(extra.chainId)) {
    order.chainId = extra.chainId;
  }
  return order;
}

/** Every hash, field, schema and signature check the hub applies to a delivered slip. */
export async function checksOut(
  seller: Address,
  outputSchema: Record<string, unknown>,
  order: JobOrder,
  payment: PaymentPayload,
  settle: SettleResult,
  delivered: { output: unknown; slip: DeliveredSlip },
): Promise<boolean> {
  try {
    const slip = delivered.slip;
    const inputHash = canonicalHash(order.input);
    const outputHash = canonicalHash(delivered.output);
    const body: SlipBody = slip.body;
    const expected = slipBodyFor(
      order,
      seller,
      inputHash,
      outputHash,
      body.deliveredAt,
      body.children,
    );

    if (slip.hash !== slipHash(body)) return false;
    if (body.outputHash !== outputHash) return false;
    if (body.inputHash !== inputHash) return false;
    if (canonicalJson(expected) !== canonicalJson(body)) return false;
    if (!checkSchema(outputSchema, delivered.output).ok) return false;

    const signer = await slipSigner({
      body,
      hash: slip.hash,
      sellerSig: slip.sellerSig,
      payment,
      settlement: { transaction: settle.transaction, network: settle.network },
    });
    return sameText(signer, seller);
  } catch {
    return false;
  }
}

export function authorizationNonce(payload: Record<string, unknown>): Hex | null {
  const authorization = payload.authorization;
  if (!isRecord(authorization)) return null;
  return asNonce(authorization.nonce);
}

export function termsDeadline(payload: Record<string, unknown>): number | null {
  const terms = payload.terms;
  if (!isRecord(terms)) return null;
  const deadline = terms.deadline;
  return typeof deadline === "number" && Number.isSafeInteger(deadline) ? deadline : null;
}
