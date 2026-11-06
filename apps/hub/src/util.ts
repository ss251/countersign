import type { Hex } from "viem";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HEX = /^0x[0-9a-fA-F]*$/;
const NONCE = /^0x[0-9a-fA-F]{64}$/;

export function asHex(value: unknown): Hex | null {
  return typeof value === "string" && HEX.test(value) ? (value as Hex) : null;
}

/** A payment nonce must be exactly 32 bytes of hex to double as an escrow job id. */
export function asNonce(value: unknown): Hex | null {
  return typeof value === "string" && NONCE.test(value) ? (value as Hex) : null;
}

export function hexList(value: unknown): Hex[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Hex => typeof item === "string" && HEX.test(item));
}

/** Compare addresses and ids without caring about case. */
export function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

export function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
