import { checkCountersign, slipHash, slipSigner, type CountersignPayload, type Slip } from "@countersign/core";
import { networkName, shortHex } from "./format.ts";

/**
 * Checks a slip in the browser with nothing but the slip: no hub, no account.
 * The same questions the verifier CLI asks, answered from the bytes.
 */

export type CheckState = "pass" | "fail";

export interface VerifyCheck {
  id: "hash" | "seller" | "countersign" | "payment" | "settlement";
  title: string;
  state: CheckState;
  /** One plain sentence: how it was checked, or what is wrong. */
  detail: string;
  /** The value the check produced, shown in mono. */
  value?: string;
}

export interface Verdict {
  valid: boolean;
  checks: VerifyCheck[];
}

export function parseSlip(text: string): { slip: Slip } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "That is not JSON. Paste the slip exactly as it was saved." };
  }
  // A paid call answers {output, slip}; accept that shape as well as a bare slip.
  const candidate = isRecord(value) && isRecord(value.slip) ? value.slip : value;
  if (!isRecord(candidate) || !isRecord(candidate.body) || typeof candidate.hash !== "string" || typeof candidate.sellerSig !== "string") {
    return { error: "That JSON is not a slip. A slip has body, hash, sellerSig, payment and settlement." };
  }
  return { slip: candidate as unknown as Slip };
}

export async function verifySlip(slip: Slip): Promise<Verdict> {
  const { body } = slip;
  const checks: VerifyCheck[] = [];

  let computed: string | undefined;
  try {
    computed = slipHash(body);
  } catch (e) {
    checks.push({ id: "hash", title: "The hash commits to every field", state: "fail", detail: `The body cannot be hashed: ${(e as Error).message}` });
  }
  if (computed !== undefined) {
    const same = computed.toLowerCase() === slip.hash.toLowerCase();
    checks.push({
      id: "hash",
      title: "The hash commits to every field",
      state: same ? "pass" : "fail",
      detail: same
        ? "Keccak-256 of the body in canonical JSON matches the slip hash."
        : `The body hashes to ${shortHex(computed)}, but the slip says ${shortHex(slip.hash)}. A field was changed.`,
      value: computed,
    });
  }

  try {
    const signer = await slipSigner(slip);
    const same = signer.toLowerCase() === body.seller.toLowerCase();
    checks.push({
      id: "seller",
      title: "Signed by the seller",
      state: same ? "pass" : "fail",
      detail: same
        ? `EIP-712 Release(jobId, slipHash)${body.escrow ? ", under the escrow contract's own domain" : ""}.`
        : `The signature recovers to ${shortHex(signer)}, not the seller ${shortHex(body.seller)}.`,
      value: signer,
    });
  } catch {
    checks.push({ id: "seller", title: "Signed by the seller", state: "fail", detail: "The seller signature does not parse." });
  }

  const accepted = slip.payment?.accepted;
  if (accepted?.scheme === "countersign") {
    checks.push(await countersignCheck(slip));
  } else if (accepted) {
    const same = accepted.amount === body.amount && accepted.payTo === body.payTo && accepted.network === body.network;
    checks.push({
      id: "payment",
      title: "The payment names this amount and this payee",
      state: same ? "pass" : "fail",
      detail: same
        ? `An x402 ${accepted.scheme} payment on ${networkName(accepted.network)} for exactly the slip's amount.`
        : "The payment's amount, payee or network differs from the slip.",
    });
  } else {
    checks.push({ id: "payment", title: "The payment names this amount and this payee", state: "fail", detail: "The slip carries no payment." });
  }

  const st = slip.settlement;
  const settled = Boolean(st?.transaction) && st.network === body.network;
  checks.push({
    id: "settlement",
    title: settled ? `Settled on ${networkName(st.network)}` : "Settled",
    state: settled ? "pass" : "fail",
    detail: settled ? "The transaction that moved the money. Open it on the explorer to see it on chain." : "The settlement is missing or names another network.",
    value: st?.transaction,
  });

  return { valid: checks.every((c) => c.state === "pass"), checks };
}

async function countersignCheck(slip: Slip): Promise<VerifyCheck> {
  const title = "Countersigned by the buyer, for this offer, at this amount";
  const { body } = slip;
  const accepted = slip.payment.accepted;
  const extra = (accepted.extra ?? {}) as { chainId?: number; escrow?: string; tokenName?: string; tokenVersion?: string };
  const p = slip.payment.payload as unknown as CountersignPayload;
  if (!p?.terms || !p.authorization || !p.signature || extra.chainId === undefined || !extra.escrow) {
    return { id: "countersign", title, state: "fail", detail: "The countersignature or its domain is missing from the payment." };
  }
  try {
    const result = await checkCountersign(p, {
      chainId: extra.chainId,
      escrow: extra.escrow as `0x${string}`,
      token: accepted.asset as `0x${string}`,
      tokenName: extra.tokenName ?? "",
      tokenVersion: extra.tokenVersion ?? "",
      // The chain enforced the time window when it funded the escrow; here only the signature and terms matter.
      now: Number(p.authorization.validAfter) + 1,
    });
    if (!result.ok) return { id: "countersign", title, state: "fail", detail: result.message };
    const mismatch =
      p.terms.offerHash.toLowerCase() !== body.offerHash.toLowerCase()
        ? "a different offer"
        : p.terms.amount !== body.amount
          ? "a different amount"
          : result.jobId.toLowerCase() !== body.jobId.toLowerCase()
            ? "a different job"
            : p.terms.payee.toLowerCase() !== body.payTo.toLowerCase()
              ? "a different payee"
              : null;
    if (mismatch) {
      return { id: "countersign", title, state: "fail", detail: `The buyer countersigned ${mismatch} from the one this slip records.` };
    }
    return {
      id: "countersign",
      title,
      state: "pass",
      detail: "One EIP-3009 signature binds the offer hash, the amount, the payee and the deadline.",
      value: result.buyer,
    };
  } catch (e) {
    return { id: "countersign", title, state: "fail", detail: `The countersignature cannot be checked: ${(e as Error).message}` };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
