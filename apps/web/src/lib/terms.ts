import { formatDuration, networkName } from "./format.ts";
import type { RailDeclaration } from "./types.ts";

/** How a rail moves the buyer's money, in the terms a person reads. */
export type TermsKind = "escrow" | "held" | "direct" | "batched";

/** A declared escrow contract is escrow; an escrow kind without one is a held schedule. */
export function termsKind(d: RailDeclaration): TermsKind {
  if (d.kind === "escrow") return d.escrow ? "escrow" : "held";
  return d.kind;
}

/** The terms this rail's own declaration supports, as [term, sentence] pairs. */
export function railTermLines(d: RailDeclaration | undefined, deadlineSeconds: number): Array<[string, string]> {
  const dur = formatDuration(deadlineSeconds);
  if (!d) return [["Not declared", "This hub does not declare this rail, so its terms are not shown."]];
  const kind = termsKind(d);
  if (kind === "escrow") {
    return [
      ["Escrow", `The money waits in the escrow contract on ${networkName(d.network)} until the output checks out.`],
      ["Refund window", `After ${dur} without delivery, anyone can refund the buyer.`],
      ["Delivery", "Released only when the output matches the schema above."],
    ];
  }
  if (kind === "held") {
    return [
      [
        "Held",
        "The buyer's payment is a Hedera schedule that moves nothing until the seller's key signs it. This hub submits that signature only after a checked delivery.",
      ],
      [
        "Limit",
        "The seller's key alone can also release it without delivering: the hold protects against a seller that fails, not one that takes the money.",
      ],
    ];
  }
  return [[kind === "direct" ? "Direct" : "Batched", `${d.finality} It pays before delivery, so a failed delivery returns nothing.`]];
}

/** What a failed delivery means for the money: only an all-escrow offer promises it back. */
export function failedDeliveryNote(kinds: Array<TermsKind | undefined>): string {
  if (kinds.length > 0 && kinds.every((kind) => kind === "escrow")) {
    return "An output that does not match is a failed delivery, and the money goes back.";
  }
  return "An output that does not match is a failed delivery. What happens to the money depends on the rail: see Terms.";
}

/** The deadline in the words the rail supports, never a refund promise on a rail that pays first. */
export function deadlineWords(kind: TermsKind | undefined, deadlineSeconds: number): string {
  const dur = formatDuration(deadlineSeconds);
  switch (kind) {
    case "escrow":
      return `${dur}, then anyone can refund`;
    case "held":
      return `${dur} to deliver; an unsigned schedule moves nothing`;
    case "direct":
    case "batched":
      return `${dur} to deliver; this rail pays first, so there is no refund`;
    default:
      return `${dur} to deliver`;
  }
}
