import { NetworkName } from "./NetworkMark.tsx";
import { formatDuration, formatMoney, networkName, shortHex, usd } from "../lib/format.ts";
import type { PendingPurchase } from "../lib/purchase.ts";
import { Amount, Button, Hash } from "./primitives.tsx";
import "./purchase.css";

/**
 * What one signature commits to, in plain words, before the wallet opens (STEER-2225 hygiene 3 and 4):
 * the offer, the payee, the amount, the chain, the escrow, the one job it can fund, and what happens next.
 * The wallet opens only from this panel's own button.
 */
export function SignReview({
  pending,
  busy,
  onConfirm,
  onCancel,
  testIdPrefix,
}: {
  pending: PendingPurchase;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testIdPrefix: "start" | "pcard";
}) {
  const { listing, authorization: a, jobId } = pending;
  const id = `${testIdPrefix}-review-title`;
  return (
    <section className="purchase__review" data-testid={`${testIdPrefix}-review`} aria-labelledby={id}>
      <p id={id} className="purchase__review-title">
        Before your wallet opens
      </p>
      <dl className="purchase__terms">
        <div>
          <dt>Offer</dt>
          <dd>
            {listing.offer.title || "Untitled offer"} <Hash value={listing.hash} label="offer hash" copy={false} />
          </dd>
        </div>
        <div>
          <dt>Payee</dt>
          <dd data-testid={`${testIdPrefix}-payee`} data-value={a.terms.payee}>
            <Hash value={a.terms.payee} label="payee" />
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd data-testid={`${testIdPrefix}-amount`} data-value={a.terms.amount}>
            <Amount money={usd(a.terms.amount, "escrow")} size="sm" />
          </dd>
        </div>
        <div>
          <dt>Chain</dt>
          <dd>
            <NetworkName name={networkName(`eip155:${a.chainId}`)} /> <span className="mono">(chain {a.chainId})</span>
          </dd>
        </div>
        <div>
          <dt>Escrow</dt>
          <dd>
            <Hash value={a.escrow} label="escrow address" />
          </dd>
        </div>
        <div>
          <dt>Job</dt>
          <dd data-testid={`${testIdPrefix}-job`} data-value={jobId}>
            <Hash value={jobId} label="job id" />
          </dd>
        </div>
      </dl>
      <p className="purchase__next">{nextWords(pending)}</p>
      <div className="purchase__actions">
        <Button variant="primary" data-testid={`${testIdPrefix}-sign`} disabled={busy} onClick={onConfirm}>
          {busy ? "Waiting for your wallet" : "Sign in my wallet"}
        </Button>
        <Button variant="secondary" data-testid={`${testIdPrefix}-cancel`} disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** What happens after the signature, in the words the review shows. */
export function nextWords(pending: PendingPurchase): string {
  const a = pending.authorization;
  const amount = formatMoney(usd(a.terms.amount, "escrow"));
  const extra = pending.req.extra as { deadlineSeconds?: unknown } | undefined;
  const window = typeof extra?.deadlineSeconds === "number" ? formatDuration(extra.deadlineSeconds) : "the deadline";
  return (
    `Your wallet asks you to sign one authorization, for job ${shortHex(pending.jobId)} only. ` +
    `The hub then moves ${amount} from your wallet into the escrow, and the seller runs the job. ` +
    `The escrow pays ${shortHex(a.terms.payee)} only if the output checks out; if it does not, anyone can refund you after ${window}.`
  );
}
