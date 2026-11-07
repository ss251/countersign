/** The rails that return money, with what each one returns. Production declares no other rail. */
export const RETURN_MONEY_RAILS: Readonly<Record<string, string>> = {
  escrow: "escrow on Arc",
  whitechain: "escrow on Whitechain",
  "hedera-scheduled": "held Hedera",
  hedera: "facilitator-paid only: x402 exact settles after delivery; a wallet-paid claim settles first",
};

/** The declared rail ids that are not rails that return money. */
export function undeclaredRails(ids: readonly string[]): string[] {
  return ids.filter((id) => !Object.hasOwn(RETURN_MONEY_RAILS, id));
}

/**
 * When "hedera" is declared, "hedera-scheduled" must be declared before it (firstmate ruling 23:01:52Z).
 * Returns the problem, or null when the order is right or "hedera" is not declared.
 */
export function railOrderProblem(ids: readonly string[]): string | null {
  const h = ids.indexOf("hedera");
  if (h === -1) return null;
  const s = ids.indexOf("hedera-scheduled");
  if (s === -1) return `production declares hedera without hedera-scheduled (it declares ${ids.join(", ")})`;
  if (s > h) return `production lists hedera before hedera-scheduled (it declares ${ids.join(", ")})`;
  return null;
}
