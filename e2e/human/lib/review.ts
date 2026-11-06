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

export interface Settlement {
  payee: string;
  amount: bigint;
  job: string;
}

export interface ReviewComparison {
  note?: string;
}

function short(job: string): string {
  return job.length > 10 ? `${job.slice(0, 10)}…` : job;
}

/**
 * Compare what settled against the review the signer saw.
 *
 * The payee and the amount must always match. The job id may differ only when Sign re-prepared the
 * terms after a wait; the returned note names the job the review showed and the one that settled.
 */
export function compareSettlement(
  review: Review,
  settlement: Settlement,
  signDelayS: number,
): ReviewComparison {
  if (settlement.payee.toLowerCase() !== review.payee.toLowerCase()) {
    throw new Error(`the review showed ${review.payee}, but the Funded payee was ${settlement.payee}`);
  }
  if (settlement.amount !== review.amount) {
    throw new Error(`the review showed ${review.amount}, but the slip's amount was ${settlement.amount}`);
  }
  if (settlement.job.toLowerCase() === review.job.toLowerCase()) return {};
  if (signDelayS === 0) {
    throw new Error(`the review showed ${review.job}, but the slip's jobId was ${settlement.job}`);
  }
  return {
    note: `the console re-prepared the terms at Sign: job ${short(review.job)} -> ${short(settlement.job)}`,
  };
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
