/**
 * The console's review before the wallet opens: the payee, the atomic amount and the one job the
 * signature can fund. The parse is pure so the offline suite can refuse each malformed value by id.
 */

export type ReviewField = "start-payee" | "start-amount" | "start-job";

export const REVIEW_FIELD: Record<ReviewField, RegExp> = {
  "start-payee": /^0x[0-9a-fA-F]{40}$/,
  "start-amount": /^[0-9]+$/,
  "start-job": /^0x[0-9a-fA-F]{64}$/,
};

export interface Review {
  payee: string;
  amount: bigint;
  job: string;
}

type ReviewInput = Partial<Record<ReviewField, string | null | undefined>>;

function read(values: ReviewInput, id: ReviewField): string {
  const value = values[id];
  if (value === null || value === undefined) {
    throw new Error(`the console does not expose ${id}[data-value] (cs-ui)`);
  }
  if (!REVIEW_FIELD[id].test(value)) {
    throw new Error(`the console's ${id}[data-value] is ${JSON.stringify(value)}, not ${REVIEW_FIELD[id]}`);
  }
  return value;
}

/** Parse the review's three values, refusing a missing or malformed one by its test id. */
export function reviewValuesOf(values: ReviewInput): Review {
  return {
    payee: read(values, "start-payee"),
    amount: BigInt(read(values, "start-amount")),
    job: read(values, "start-job"),
  };
}
