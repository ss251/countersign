// The fee payers this buyer will sign for, read live from the same hosted facilitators the
// hedera agent uses. A hub cannot nominate one of its own accounts as the fee payer.
import { FACILITATORS, httpFacilitator } from "@countersign/rail/hedera";

let trusted: Set<string> | null = null;
let pending: Promise<Set<string>> | null = null;

/** The facilitators' published fee payers. An empty answer is not cached, so it is retried. */
export function trustedHederaFeePayers(): Promise<Set<string>> {
  if (trusted !== null) return Promise.resolve(trusted);
  pending ??= (async () => {
    const found = new Set<string>();
    await Promise.all(
      FACILITATORS.map(async ({ name, url }) => {
        try {
          const feePayer = await httpFacilitator(name, url, 10_000).feePayer();
          if (feePayer) found.add(feePayer);
        } catch {
          // An unreachable facilitator contributes no fee payer.
        }
      }),
    );
    if (found.size > 0) trusted = found;
    pending = null;
    return found;
  })();
  return pending;
}
