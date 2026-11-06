import { describe, expect, test } from "bun:test";
import { compareSettlement, reviewValuesOf } from "../lib/review.ts";

const PAYEE = `0x${"11".repeat(20)}`;
const JOB = `0x${"ab".repeat(32)}`;
const VALID = { "start-payee": PAYEE, "start-amount": "1000000", "start-job": JOB };

describe("the review values", () => {
  test("a valid set parses the payee, atomic amount and job", () => {
    expect(reviewValuesOf(VALID)).toEqual({ payee: PAYEE, amount: 1_000_000n, job: JOB });
  });

  test("each missing value names its id", () => {
    for (const id of ["start-payee", "start-amount", "start-job"] as const) {
      const values = { ...VALID };
      delete (values as Partial<typeof VALID>)[id];
      expect(() => reviewValuesOf(values)).toThrow(`the console does not expose ${id}[data-value] (cs-ui)`);
      expect(() => reviewValuesOf({ ...VALID, [id]: null })).toThrow(
        `the console does not expose ${id}[data-value] (cs-ui)`,
      );
    }
  });

  test("each malformed value names its id", () => {
    const cases = [
      ["start-payee", ""],
      ["start-payee", "0x1234"],
      ["start-payee", `0x${"gg".repeat(20)}`],
      ["start-amount", ""],
      ["start-amount", "1.5"],
      ["start-amount", "-1"],
      ["start-job", ""],
      ["start-job", `0x${"ab".repeat(31)}`],
      ["start-job", `0x${"ab".repeat(33)}`],
    ] as const;
    for (const [id, value] of cases) {
      expect(() => reviewValuesOf({ ...VALID, [id]: value })).toThrow(id);
    }
  });
});

describe("the review against what settled", () => {
  const REVIEW = reviewValuesOf(VALID);
  const SETTLED = { payee: PAYEE, amount: 1_000_000n, job: JOB };
  const OTHER_JOB = `0x${"cd".repeat(32)}`;
  const OTHER_PAYEE = `0x${"22".repeat(20)}`;

  const REBUILT = {
    note: `the console rebuilt the terms at Sign: job ${JOB.slice(0, 10)}… -> ${OTHER_JOB.slice(0, 10)}…`,
  };

  test("with no delay, a different job id passes and returns the rebuilt note", () => {
    expect(compareSettlement(REVIEW, { ...SETTLED, job: OTHER_JOB }, 0)).toEqual(REBUILT);
  });

  test("with a delay, a different job id passes and returns the rebuilt note", () => {
    expect(compareSettlement(REVIEW, { ...SETTLED, job: OTHER_JOB }, 180)).toEqual(REBUILT);
  });

  test("with no delay, a different payee still fails", () => {
    expect(() => compareSettlement(REVIEW, { ...SETTLED, payee: OTHER_PAYEE }, 0)).toThrow(
      `the review showed ${PAYEE}, but the Funded payee was ${OTHER_PAYEE}`,
    );
  });

  test("with a delay, a different payee still fails", () => {
    expect(() => compareSettlement(REVIEW, { ...SETTLED, payee: OTHER_PAYEE }, 180)).toThrow(
      `the review showed ${PAYEE}, but the Funded payee was ${OTHER_PAYEE}`,
    );
  });

  test("with no delay, a different amount still fails", () => {
    expect(() => compareSettlement(REVIEW, { ...SETTLED, amount: 999_999n }, 0)).toThrow(
      `the review showed 1000000, but the slip's amount was 999999`,
    );
  });

  test("with a delay, a different amount still fails", () => {
    expect(() => compareSettlement(REVIEW, { ...SETTLED, amount: 999_999n }, 180)).toThrow(
      `the review showed 1000000, but the slip's amount was 999999`,
    );
  });

  test("the same job id passes without a note, with or without a delay", () => {
    expect(compareSettlement(REVIEW, SETTLED, 0)).toEqual({});
    expect(compareSettlement(REVIEW, SETTLED, 180)).toEqual({});
  });
});
