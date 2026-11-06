import { randomBytes } from "node:crypto";
import type { Hex, LocalAccount } from "viem";
import { signAuthorization, authorizationToWire, sameAddress } from "./eip3009.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";

export type RefundPayment = {
  payer: string;
  payTo: string;
  amount: bigint;
  refunded: bigint;
};

export type SignRefundInput = {
  merchant: LocalAccount;
  payment: RefundPayment;
  amount?: bigint;
  now: number;
  validForSeconds?: number;
};

export type SignedRefund = {
  authorization: WireAuthorization;
  signature: Hex;
};

export async function signRefund(input: SignRefundInput): Promise<SignedRefund> {
  if (!sameAddress(input.merchant.address, input.payment.payTo)) {
    throw new Error("merchant does not own this payment");
  }
  const refundable = input.payment.amount - input.payment.refunded;
  const value = input.amount ?? refundable;
  if (value <= 0n) throw new Error("nothing to refund");
  if (value > refundable) throw new Error("refund exceeds the refundable amount");

  const validForSeconds = input.validForSeconds ?? 300;
  const authorization: Authorization = {
    from: input.merchant.address,
    to: input.payment.payer as Authorization["to"],
    value,
    validAfter: 0n,
    validBefore: BigInt(input.now + validForSeconds),
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const signature = await signAuthorization(input.merchant, authorization);
  return { authorization: authorizationToWire(authorization), signature };
}
