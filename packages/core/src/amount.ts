/**
 * Atomic amounts. In code an amount is a bigint count of the token's smallest
 * unit; on the wire it is a base-10 string of digits. Floats never touch money.
 */

const DIGITS = /^(0|[1-9][0-9]*)$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export class AmountError extends Error {
  override name = "AmountError";
}

/** Parse a wire amount ("1500000") into a bigint. Rejects signs, spaces, exponents, leading zeros. */
export function parseAtomic(wire: string): bigint {
  if (typeof wire !== "string" || !DIGITS.test(wire)) {
    throw new AmountError(`not an atomic amount: ${JSON.stringify(wire)}`);
  }
  return BigInt(wire);
}

/** Serialise a bigint amount for the wire. Rejects negatives. */
export function atomicToWire(amount: bigint): string {
  if (typeof amount !== "bigint" || amount < 0n) {
    throw new AmountError(`not a non-negative bigint: ${String(amount)}`);
  }
  return amount.toString(10);
}

/** "1.5" with 6 decimals -> 1500000n. Rejects more fractional digits than the token has. */
export function parseUnits(decimal: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (typeof decimal !== "string" || !DECIMAL.test(decimal)) {
    throw new AmountError(`not a decimal amount: ${JSON.stringify(decimal)}`);
  }
  const [whole = "0", frac = ""] = decimal.split(".");
  if (frac.length > decimals) {
    throw new AmountError(`${decimal} has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 1500000n with 6 decimals -> "1.5". Trailing zeros dropped, no exponent, never rounds. */
export function formatUnits(amount: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (typeof amount !== "bigint" || amount < 0n) {
    throw new AmountError(`not a non-negative bigint: ${String(amount)}`);
  }
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString(10).padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString(10);
}

/** Basis-point share of an amount, rounded down. 10_000 bps = 100%. */
export function bpsOf(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new AmountError(`bps out of range: ${bps}`);
  }
  return (amount * BigInt(bps)) / 10_000n;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AmountError(`bad decimals: ${decimals}`);
  }
}
