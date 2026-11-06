import { formatAmount, remainingAtomic, usd } from "./format.ts";
import type { EnvelopeView } from "./types.ts";

export type CheckKind = "pass" | "fail" | "ask";

export interface Check {
  kind: CheckKind;
  text: string;
}

/**
 * The envelope read against one call, a line per rule, in the words a person checks it by.
 * Same semantics as checkEnvelope in core: an empty allowlist means any seller, a per-seller
 * override beats the default limit, and the call needs a person only above askAbove.
 */
export function envelopeChecklist(
  view: EnvelopeView,
  call: { seller: string; offerHash: string; amount: string; sellerName: string },
): Check[] {
  const { envelope: env, spent } = view;
  const seller = call.seller.toLowerCase();
  const amount = BigInt(call.amount);
  const capLeft = remainingAtomic(env.cap, spent.total);
  const limit = env.merchantLimits?.[seller] ?? env.perMerchant;
  const sellerLeft = remainingAtomic(limit, spent.bySeller[seller] ?? "0");
  const allowed =
    env.allowlist.length === 0 ||
    env.allowlist.some((e) => e.toLowerCase() === seller || e.toLowerCase() === call.offerHash.toLowerCase());
  const n = (atomic: string) => formatAmount(usd(atomic));
  const out: Check[] = [];
  if (env.revoked) out.push({ kind: "fail", text: "The envelope is revoked" });
  out.push(
    amount <= BigInt(capLeft)
      ? { kind: "pass", text: `Within budget, ${n(capLeft)} left` }
      : { kind: "fail", text: `Over budget, only ${n(capLeft)} left` },
  );
  out.push(
    amount <= BigInt(sellerLeft)
      ? { kind: "pass", text: `Under the per-seller cap, ${n(sellerLeft)} left for ${call.sellerName}` }
      : { kind: "fail", text: `Over the per-seller cap, only ${n(sellerLeft)} left for ${call.sellerName}` },
  );
  out.push(
    allowed
      ? { kind: "pass", text: env.allowlist.length === 0 ? "Any seller allowed: the allowlist is empty" : "Seller on the allowlist" }
      : { kind: "fail", text: "Seller not on the allowlist" },
  );
  if (view.askAbove === null) {
    out.push({ kind: "pass", text: "No ask threshold, so the agent buys it alone" });
  } else if (amount > BigInt(view.askAbove)) {
    out.push({ kind: "ask", text: `Above your ask threshold of ${n(view.askAbove)}, so it needs you` });
  } else {
    out.push({ kind: "pass", text: `Under your ask threshold of ${n(view.askAbove)}, so the agent buys it alone` });
  }
  return out;
}
