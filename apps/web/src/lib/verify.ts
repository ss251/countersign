import { slipHash, type Slip } from "@countersign/core";
import { verifySlip as runVerifier, type Finding } from "@countersign/verify";
import { networkName } from "./format.ts";

/**
 * The page runs the same verifier as the CLI (@countersign/verify). Offline it checks
 * what the slip proves by itself: the hash, the seller's signature and the buyer's
 * countersignature. Settlement is never ticked from the slip's own say-so: it counts
 * only when the page has read the release from the chain, and only when asked to.
 */

export type CheckState = "pass" | "fail" | "info";

export interface VerifyCheck {
  id: string;
  title: string;
  state: CheckState;
  /** One plain sentence: how it was checked, or what is wrong. */
  detail: string;
  /** A value worth comparing by eye, shown in mono. */
  value?: string;
}

export interface Verdict {
  valid: boolean;
  checks: VerifyCheck[];
  /** Whether the release was read from the chain for this verdict. */
  chain: "read" | "not-read";
  /** The network that was asked, when it was. */
  network?: string;
}

/** Public RPCs the page may ask, only when the person presses the button. */
const PUBLIC_RPC: Record<string, string> = {
  "eip155:5042002": "https://rpc.testnet.arc.network",
  "eip155:1874": "https://rpc.testnet.whitechain.io",
};

/** True when this slip's release can be read from a public RPC: an escrow rail on a known chain. */
export function canReadChain(slip: Slip): boolean {
  return Boolean(slip.body.escrow && PUBLIC_RPC[slip.body.network]);
}

export function parseSlip(text: string): { slip: Slip } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "That is not JSON. Paste the slip exactly as it was saved." };
  }
  // A paid call answers {output, slip}; accept that shape as well as a bare slip.
  const candidate = isRecord(value) && isRecord(value.slip) ? value.slip : value;
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.body) ||
    typeof candidate.hash !== "string" ||
    typeof candidate.sellerSig !== "string" ||
    !isRecord(candidate.payment) ||
    !isRecord(candidate.settlement)
  ) {
    return { error: "That JSON is not a slip. A slip has body, hash, sellerSig, payment and settlement." };
  }
  return { slip: candidate as unknown as Slip };
}

export async function verifySlip(slip: Slip, options: { readChain?: boolean } = {}): Promise<Verdict> {
  const rpcUrl = options.readChain && canReadChain(slip) ? PUBLIC_RPC[slip.body.network] : undefined;
  let findings: Finding[];
  try {
    findings = (await runVerifier(slip, rpcUrl ? { rpcUrl } : {})).findings;
  } catch (e) {
    findings = [{ check: "hash", ok: false, detail: `the slip cannot be checked: ${(e as Error).message.split("\n")[0]}` }];
  }

  const exact = slip.payment?.accepted?.scheme !== "countersign";
  const checks: VerifyCheck[] = [];
  for (const f of findings) {
    const c = present(f, slip, exact);
    if (c) checks.push(c);
  }

  if (!rpcUrl) {
    checks.push({
      id: "settlement",
      title: "Settlement not read from the chain",
      state: "info",
      detail: canReadChain(slip)
        ? `The slip names the transaction below. Read it from ${networkName(slip.body.network)} here, or open it on the explorer.`
        : "The slip names the transaction below. Open it on the explorer to see it settle.",
      value: slip.settlement?.transaction,
    });
  }

  return {
    valid: checks.every((c) => c.state !== "fail"),
    checks,
    chain: rpcUrl ? "read" : "not-read",
    network: rpcUrl ? slip.body.network : undefined,
  };
}

function present(f: Finding, slip: Slip, exact: boolean): VerifyCheck | null {
  switch (f.check) {
    case "hash": {
      let computed: string | undefined;
      try {
        computed = slipHash(slip.body);
      } catch {
        computed = undefined;
      }
      return {
        id: "hash",
        title: "The hash commits to every field",
        state: f.ok ? "pass" : "fail",
        detail: f.ok ? "Keccak-256 of the body in canonical JSON is the slip hash, so no field has changed." : sentence(f.detail),
        value: computed,
      };
    }
    case "seller":
      return {
        id: "seller",
        title: "Signed by the seller",
        state: f.ok ? "pass" : "fail",
        detail: f.ok
          ? `EIP-712 Release(jobId, slipHash)${slip.body.escrow ? ", under the escrow contract's own domain" : ""}.`
          : sentence(f.detail),
        value: slip.body.seller,
      };
    case "terms":
      return {
        id: "terms",
        title: "The buyer agreed to this offer, payee and amount",
        state: f.ok ? "pass" : "fail",
        detail: f.ok ? "The countersigned terms derive this slip's job id." : sentence(f.detail),
      };
    case "countersignature":
      if (exact) {
        // The CLI passes this for exact-scheme rails without checking anything, so it is not a tick here.
        return {
          id: "countersignature",
          title: "Paid by x402 exact",
          state: "info",
          detail: "This rail checks the buyer's signature when it settles. The slip carries no countersignature to check.",
        };
      }
      return {
        id: "countersignature",
        title: "Countersigned by the buyer",
        state: f.ok ? "pass" : "fail",
        detail: f.ok ? "One EIP-3009 signature names the escrow and binds the amount and the job." : sentence(f.detail),
        value: buyerOf(slip),
      };
    case "onchain":
      if (!slip.body.escrow) return null;
      return {
        id: "onchain",
        title: f.ok ? `Released on ${networkName(slip.body.network)}` : "Not released on chain",
        state: f.ok ? "pass" : "fail",
        detail: f.ok
          ? `Read from ${networkName(slip.body.network)}'s public RPC: the escrow emitted Released for this job and this slip hash.`
          : sentence(f.detail),
        value: slip.settlement?.transaction,
      };
    default:
      return { id: f.check, title: f.check, state: f.ok ? "pass" : "fail", detail: sentence(f.detail) };
  }
}

function buyerOf(slip: Slip): string | undefined {
  const p = slip.payment?.payload as { terms?: { buyer?: string } } | undefined;
  return p?.terms?.buyer;
}

/** The CLI's findings are terse and lowercase; on the page they read as sentences. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
