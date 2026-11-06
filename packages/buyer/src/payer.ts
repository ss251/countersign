import type { Hex } from "viem";
import type { LocalAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  jobIdOf,
  type AuthorizationInput,
  type CountersignExtra,
  type CountersignTerms,
  type PaymentPayload,
  type PaymentRequirements,
} from "@countersign/core";
import type { Address } from "viem";

export interface Payer {
  canPay(req: PaymentRequirements): boolean;
  pay(req: PaymentRequirements, ctx: { now: number }): Promise<{ payment: PaymentPayload; jobId: Hex }>;
}

function randomSalt(): string {
  const words = crypto.getRandomValues(new Uint32Array(8));
  let n = 0n;
  for (const w of words) n = (n << 32n) | BigInt(w);
  return n.toString(10);
}

/** Signs typed data and nothing else. No gas, no chain access. */
export function countersignPayer(account: LocalAccount): Payer {
  return {
    canPay(req) {
      return req.scheme === "countersign" && req.network.startsWith("eip155:");
    },
    async pay(req, ctx) {
      const extra = req.extra as unknown as CountersignExtra;
      const terms: CountersignTerms = {
        offerHash: extra.offerHash,
        buyer: account.address,
        payee: req.payTo as Address,
        amount: req.amount,
        deadline: ctx.now + extra.deadlineSeconds,
        salt: randomSalt(),
      };
      const input: AuthorizationInput = {
        terms,
        chainId: extra.chainId,
        escrow: extra.escrow,
        token: req.asset as Address,
        tokenName: extra.tokenName,
        tokenVersion: extra.tokenVersion,
        validAfter: 0,
        validBefore: ctx.now + 600,
      };
      const sig = await account.signTypedData(authorizationTypedData(input));
      return {
        payment: { x402Version: 2, accepted: req, payload: countersignPayload(input, sig) as unknown as Record<string, unknown> },
        jobId: jobIdOf(terms, extra.chainId, extra.escrow),
      };
    },
  };
}
