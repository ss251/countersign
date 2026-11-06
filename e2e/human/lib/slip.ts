/** The slip hash a console link names, or undefined when the link is not `#/verify/<hash>`. */
export function slipHashFromHref(href: string): string | undefined {
  const match = /#\/verify\/(0x[0-9a-fA-F]{64})$/.exec(href);
  return match?.[1];
}

/** The address production's `/rails` declares for the rail with id "escrow", or null. */
export function escrowRailAddress(rails: unknown): string | null {
  if (typeof rails !== "object" || rails === null) return null;
  const list = (rails as Record<string, unknown>).rails;
  if (!Array.isArray(list)) return null;
  for (const rail of list) {
    if (typeof rail !== "object" || rail === null) continue;
    const record = rail as Record<string, unknown>;
    if (record.id !== "escrow") continue;
    const escrow = record.escrow;
    return typeof escrow === "string" && /^0x[0-9a-fA-F]{40}$/.test(escrow) ? escrow : null;
  }
  return null;
}
