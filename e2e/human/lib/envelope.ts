/**
 * The checks a session envelope must pass. The hub's POST /envelopes/session defaults are fixed by
 * D23; a repeat run reads the existing envelope back, so only its expiry may be earlier than a
 * fresh 24 hours.
 */

/** The session route's fixed limits, in atomic six-decimal USDC. */
export const SESSION_DEFAULTS = {
  cap: "1000000",
  perMerchant: "500000",
  askAbove: "50000",
} as const;

/** D23: a session envelope and its token live 24 hours; the hub allows five minutes of clock skew. */
export const SESSION_TTL = 86_400;
export const SESSION_SKEW = 300;

export type SessionEnvelope = Record<string, unknown>;

function sameAddress(value: unknown, wallet: string): boolean {
  return typeof value === "string" && value.toLowerCase() === wallet.toLowerCase();
}

/**
 * Every way `envelope` differs from the session defaults for `wallet`, as strings that name the
 * field and the expected value. Empty means it matches.
 */
export function sessionEnvelopeProblems(
  envelope: SessionEnvelope,
  wallet: string,
  nowSeconds: number,
): string[] {
  const problems: string[] = [];
  if (envelope.cap !== SESSION_DEFAULTS.cap) {
    problems.push(`cap is not ${JSON.stringify(SESSION_DEFAULTS.cap)}`);
  }
  if (envelope.askAbove !== SESSION_DEFAULTS.askAbove) {
    problems.push(`askAbove is not ${JSON.stringify(SESSION_DEFAULTS.askAbove)}`);
  }
  if (envelope.perMerchant !== SESSION_DEFAULTS.perMerchant) {
    problems.push(`perMerchant is not ${JSON.stringify(SESSION_DEFAULTS.perMerchant)}`);
  }
  if (envelope.revoked !== false) {
    problems.push("revoked is not false");
  }
  if (!Array.isArray(envelope.allowlist) || envelope.allowlist.length !== 0) {
    problems.push("allowlist is not []");
  }
  if (!sameAddress(envelope.agent, wallet)) {
    problems.push(`agent is not ${wallet}`);
  }
  if (!sameAddress(envelope.approver, wallet)) {
    problems.push(`approver is not ${wallet}`);
  }
  const expiresAt = envelope.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    problems.push(`expiresAt is not after ${nowSeconds}`);
  } else if (expiresAt > nowSeconds + SESSION_TTL + SESSION_SKEW) {
    problems.push(`expiresAt is after ${nowSeconds + SESSION_TTL + SESSION_SKEW} (24 h plus 5 min ahead)`);
  }
  return problems;
}
