import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { checkEnvelope, type EnvelopeDecision } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, followJob, playJob, type JobControl, type JobStep, type JobView, type Resource, type Scenario } from "../../lib/api.ts";
import { useNow } from "../../lib/now.ts";
import {
  ESCROW_RAILS,
  formatClock,
  formatDuration,
  formatMoney,
  nowUnix,
  RAIL_LABEL,
  shortHex,
  usd,
} from "../../lib/format.ts";
import { approvalToken, HubError, rememberApprovalToken } from "../../lib/hub.ts";
import { envelopeChecklist, type Check } from "../../lib/checklist.ts";
import type { Approval, EnvelopeView, Money } from "../../lib/types.ts";
import { Absent } from "../../ui/Absent.tsx";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, cx, Empty, Hash, Tag } from "../../ui/primitives.tsx";

interface Props {
  approvals: Resource<Approval[] | null>;
  envelope: Resource<EnvelopeView | null>;
  query: URLSearchParams;
  onSigned: (a: Approval) => void;
  onSettled: (a: Approval, job: JobView) => void;
  onClose: (a: Approval) => void;
}

export function Approvals({ approvals, envelope, query, onSigned, onSettled, onClose }: Props) {
  const current = approvals.data?.[0];

  if (approvals.source === "absent") {
    return (
      <Absent reason={approvals.reason ?? "This hub has no approvals to show."} onRetry={approvals.reload}>
        {approvals.needsToken && !approvalToken() ? (
          <TokenForm
            onSave={(t) => {
              rememberApprovalToken(t);
              approvals.reload();
            }}
          />
        ) : null}
      </Absent>
    );
  }
  if (approvals.loading && approvals.data === undefined) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  if (!current) {
    const ask = envelope.data?.askAbove;
    return (
      <Empty title="Nothing is waiting for you.">
        {ask === null
          ? "Your agent buys inside its envelope on its own and never asks you first."
          : `Your agent buys inside the envelope on its own and asks you only above ${ask ? formatMoney(usd(ask)) : "your limit"}.`}{" "}
        {approvals.source === "hub" ? "A request shows here as soon as it asks. " : null}
        <Link to="/buyer?tab=history">See what it bought</Link>.
      </Empty>
    );
  }

  const asked = query.get("scenario");
  const scenario: Scenario = asked === "moved" || asked === "deadline" ? asked : "release";

  return (
    <ApprovalFlow
      key={current.id}
      approval={current}
      view={envelope.data ?? null}
      scenario={scenario}
      onSigned={() => onSigned(current)}
      onSettled={(job) => onSettled(current, job)}
      onClose={() => onClose(current)}
    />
  );
}

function ApprovalFlow({
  approval,
  view,
  scenario,
  onSigned,
  onSettled,
  onClose,
}: {
  approval: Approval;
  /** Null when the hub holds no envelope for this agent: the phone then says what the agent checked. */
  view: EnvelopeView | null;
  scenario: Scenario;
  onSigned: () => void;
  onSettled: (job: JobView) => void;
  onClose: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  /** The running job: stop it on unmount, and, inside the review window, accept or dispute it. */
  const control = useRef<JobControl | null>(null);
  // The envelope the human saw when signing. Checks must not re-run against the spend this call adds.
  const [seen] = useState(view);
  const { listing } = approval;
  const { offer } = listing;
  const money = usd(approval.amount, approval.rail);
  const toll = ESCROW_RAILS.has(approval.rail) ? splitToll(approval.amount) : null;
  /** The request came through the hub from a real agent, not from fixtures. */
  const live = approval.agent !== undefined;
  /*
   * The agent checked a hub request against its real envelope before sending it. Without the agent's
   * signed mirror the phone holds only stand-in limits, and re-checking against those could only refuse
   * falsely, so it says what the agent checked instead.
   */
  const real = seen && !(live && seen.mirror === undefined) ? seen : null;
  const blind = real === null;
  const checks = real
    ? envelopeChecklist(real, { seller: offer.seller, offerHash: listing.hash, amount: approval.amount, sellerName: listing.seller.name })
    : AGENT_CHECKED;
  const decision: EnvelopeDecision = real
    ? checkEnvelope(real.envelope, real.spent, { seller: offer.seller, offerHash: listing.hash, amount: approval.amount }, nowUnix())
    : { ok: true };
  const final = job && (job.step === "released" || job.step === "refused" || job.step === "refunded" || job.step === "failed");
  const [token, setToken] = useState(approvalToken);
  const [sending, setSending] = useState<"countersign" | "decline" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Decided elsewhere or expired: nothing more can happen to this request. */
  const [gone, setGone] = useState(false);
  /** Bumped after a failed send so the hold starts over instead of reading "Countersigned". */
  const [attempt, setAttempt] = useState(0);

  const fail = (e: unknown) => {
    if (e instanceof HubError && e.status === 401) {
      rememberApprovalToken(null);
      setToken(null);
      setProblem(e.code === "no-token" ? null : "The hub did not accept that token. Nothing was signed. Paste it again.");
    } else if (e instanceof HubError && (e.status === 409 || e.status === 404)) {
      setGone(true);
      setProblem(
        e.status === 404
          ? "The hub no longer knows this request. Nothing was signed."
          : "This request was already decided, or it expired. Nothing was signed.",
      );
    } else if (e instanceof HubError && e.status === 503) {
      setProblem("This hub has no approver set, so it cannot take a countersignature from a phone. Nothing was signed.");
    } else {
      setProblem("The hub did not answer. Nothing was signed. Hold again to retry.");
    }
  };

  const countersign = async () => {
    if (!live) {
      onSigned();
      control.current = playJob(approval, scenario, setJob);
      return;
    }
    setSending("countersign");
    setProblem(null);
    try {
      const known = await api.jobIds(approval.agent!);
      await api.decide(approval.id, "countersign");
      onSigned();
      control.current = { stop: followJob(approval, known, setJob) };
    } catch (e) {
      fail(e);
      setAttempt((n) => n + 1);
    } finally {
      setSending(null);
    }
  };

  const decline = async () => {
    if (!live) return onClose();
    setSending("decline");
    setProblem(null);
    try {
      await api.decide(approval.id, "decline");
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSending(null);
    }
  };
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => () => control.current?.stop(), []);
  useEffect(() => {
    if (final && job) onSettledRef.current(job);
    // Report each final step once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);

  const slip = job?.step === "released" ? job.slipHash : undefined;

  return (
    <article className="approval" aria-labelledby="approval-title">
      {/* The purchase, as a pass: who pays whom, for what, exactly how much, and the stub that becomes the slip. */}
      <section className={cx("pass", slip && "pass--slipped")} aria-label="The purchase">
        <div className="pass__ends">
          <div className="pass__end">
            <span className="label">
              Agent{live ? <span className="num"> · asked {formatClock(approval.requestedAt)}</span> : null}
            </span>
            <span className="pass__who mono">{approval.agentName}</span>
          </div>
          <svg className="pass__arrow" viewBox="0 0 28 12" width="28" height="12" aria-hidden="true">
            <path d="M1 6h24M20 1.5L25.5 6 20 10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="pass__end pass__end--to">
            <span className="label">Seller</span>
            <span className="pass__who">{listing.seller.named === false ? "Unnamed seller" : listing.seller.name}</span>
            <span className="pass__sub pass__payee">
              <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                <rect x="2.25" y="5.25" width="7.5" height="5.25" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4 5.25V3.75a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className="sr-only">Payee locked: </span>
              <Hash value={offer.seller} label="payee address" copy={false} />
            </span>
          </div>
        </div>

        <div className="pass__what">
          <div className="pass__title-row">
            <h1 id="approval-title" className="pass__title">
              {offer.title}
            </h1>
            <p className="pass__meta">
              <Tag>{offer.adapter}</Tag>
              {offer.upstream ? (
                <a href={offer.upstream.url} target="_blank" rel="noreferrer" className="pass__source">
                  {upstreamLabel(offer.upstream.url)}
                </a>
              ) : null}
            </p>
          </div>
          <p className="pass__summary" title={offer.summary}>
            {offer.summary}
          </p>
        </div>

        <div className="pass__exact">
          <span className="label">You countersign exactly</span>
          <Amount money={money} size="xl" flight />
        </div>

        <dl className="pass__fields">
          <div>
            <dt className="label">Rail</dt>
            <dd>{RAIL_LABEL[approval.rail]}</dd>
          </div>
          <div>
            <dt className="label">Deadline</dt>
            <dd className="num">{formatDuration(offer.deadline)}</dd>
          </div>
          <div>
            <dt className="label">Bond</dt>
            <dd>
              <Amount money={usd(offer.bond, approval.rail)} size="sm" />
            </dd>
          </div>
          {toll ? (
            <>
              <div>
                <dt className="label">Toll, {TOLL_BPS / 100}%</dt>
                <dd>
                  <Amount money={usd(toll.toll, approval.rail)} size="sm" />
                </dd>
              </div>
              <div>
                <dt className="label">Seller gets</dt>
                <dd>
                  <Amount money={usd(toll.net, approval.rail)} size="sm" />
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt className="label">Offer</dt>
            <dd>
              <Hash value={listing.hash} head={6} tail={4} copy={false} label="offer hash" />
            </dd>
          </div>
        </dl>

        <div className="pass__stub" aria-live="polite">
          <span className="label">Slip</span>
          {slip ? (
            <span className="pass__slip">
              <span className="status status--released">Released</span>
              <Link to={`/slip/${slip}`} className="pass__slip-link mono">
                {shortHex(slip, 10, 8)}
              </Link>
              {job?.times.released ? <span className="pass__slip-time num">{formatClock(job.times.released)}</span> : null}
            </span>
          ) : (
            <span className="pass__stub-wait">Issued when the output checks out</span>
          )}
        </div>
      </section>

      {job ? (
        <JobLedger job={job} approval={approval} />
      ) : (
        <section className="checks" aria-labelledby="checks-title">
          <h2 id="checks-title" className="label">
            Your envelope
          </h2>
          <Checklist items={checks} />
          {decision.ok ? null : <p className="checks__refusal">{decision.message}</p>}
        </section>
      )}

      {final ? (
        <Outcome job={job!} approval={approval} onClose={onClose} />
      ) : gone ? (
        <div className="outcome" role="status">
          <p className="outcome__title">Nothing to sign.</p>
          <p className="outcome__body">{problem}</p>
          <Button variant="primary" block onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="approval__dock">
          <div className="approval__dock-line">
            <p className="approval__dock-what">
              <Amount money={money} size="sm" flight />{" "}
              <span className="approval__dock-to">to {listing.seller.named === false ? "an unnamed seller" : listing.seller.name}</span>
            </p>
            {job ? null : (
              <button type="button" className="approval__decline" disabled={sending !== null} onClick={() => void decline()}>
                {sending === "decline" ? "Declining" : "Decline"}
              </button>
            )}
          </div>
          {problem ? (
            <p className="approval__problem" role="alert">
              {problem}
            </p>
          ) : null}
          {job?.step === "review" ? (
            <ReviewActions control={control.current} money={money} seller={listing.seller.named === false ? "the seller" : listing.seller.name} />
          ) : live && !token ? (
            <TokenForm
              onSave={(t) => {
                rememberApprovalToken(t);
                setToken(t);
                setProblem(null);
              }}
            />
          ) : (
            <HoldToSign
              key={attempt}
              ariaLabel={`Countersign ${formatMoney(money)} to ${offer.title}`}
              left={listing.seller.name}
              right="you"
              disabled={!decision.ok || sending !== null}
              signed={job !== null}
              label={decision.ok ? "Hold to countersign" : "The envelope refuses this call"}
              doneLabel={sending === "countersign" ? "Sending to the hub" : "Countersigned"}
              onSigned={() => void countersign()}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** What the phone can say about a hub request when it does not hold the agent's signed envelope. */
const AGENT_CHECKED: Check[] = [
  { kind: "pass", text: "Within budget, under the per-seller cap and on the allowlist: your agent checked before asking" },
  { kind: "ask", text: "Above your ask threshold, so it needs you" },
];

/** The human's approval token for this hub. Pasted once; it stays on this phone. */
export function TokenForm({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t) {
      setError("Paste the token first.");
      return;
    }
    onSave(t);
  };
  return (
    <form className="token" onSubmit={submit} noValidate>
      <label className="field__label" htmlFor={id}>
        Approval token
      </label>
      <input
        id={id}
        className="input mono"
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        data-1p-ignore
        data-lpignore="true"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setValue(e.target.value);
          if (error && e.target.value.trim()) setError(null);
        }}
      />
      <p id={`${id}-hint`} className={error ? "field__error" : "field__hint"}>
        {error ?? "The approver token your hub was started with. It stays on this phone and goes only to this hub."}
      </p>
      <Button variant="primary" type="submit" block>
        Use this token
      </Button>
    </form>
  );
}

/** Both escrow deployments set tollBps to 100 (docs/decisions.md). */
const TOLL_BPS = 100;

/** The toll comes out of the amount, rounded down, exactly as the contract computes it. */
function splitToll(amount: string): { toll: string; net: string } {
  const a = BigInt(amount);
  const toll = (a * BigInt(TOLL_BPS)) / 10_000n;
  return { toll: toll.toString(), net: (a - toll).toString() };
}

function upstreamLabel(url: string): string {
  const gh = url.match(/github\.com\/([^/]+\/[^/#?]+)/);
  if (gh) return gh[1]!;
  const npm = url.match(/npmjs\.com\/package\/(.+)$/);
  if (npm) return npm[1]!;
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/*
 * Inside the review window: accepting is the one action, disputing the quieter second, behind a
 * sheet that says exactly what a dispute does to the money and to the seller's bond.
 */
function ReviewActions({ control, money, seller }: { control: JobControl | null; money: Money; seller: string }) {
  const sheet = useRef<HTMLDialogElement>(null);
  if (!control?.accept || !control.dispute) {
    return <p className="review__note">Your agent accepts or disputes this delivery from its own machine.</p>;
  }
  return (
    <div className="review">
      <Button variant="money" block onClick={control.accept}>
        Accept delivery
      </Button>
      <button type="button" className="review__dispute" onClick={() => sheet.current?.showModal()}>
        Dispute
      </button>
      <dialog ref={sheet} className="sheet" aria-labelledby="dispute-title">
        <form method="dialog" className="sheet__body">
          <h2 id="dispute-title" className="sheet__title">
            Dispute this delivery?
          </h2>
          <p className="sheet__text">
            The escrow refunds <Amount money={money} size="sm" /> to your agent instead of paying {seller}. The seller’s bond is not
            touched: a dispute is not a failed delivery.
          </p>
          <div className="sheet__buttons">
            <Button
              variant="seal"
              block
              onClick={() => {
                sheet.current?.close();
                control.dispute?.();
              }}
            >
              Dispute
            </Button>
            <Button variant="secondary" block type="submit">
              Keep it
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

/** The review window, counting down in mono: fixed-width digits, so nothing shifts as it ticks. */
function Countdown({ until }: { until: number }) {
  const now = useNow(1000);
  const left = Math.max(0, until - now);
  const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  // A timer is not a live region: a reader hears its end time once, not every second.
  return (
    <span className="countdown num" role="timer" aria-label={`Review window closes at ${formatClock(until)}`}>
      {text} left
    </span>
  );
}

/* After the hold: what has happened, in order, to the second. */

function JobLedger({ job, approval }: { job: JobView; approval: Approval }) {
  if (job.step === "refused" || job.step === "refunded" || job.step === "failed") return null;
  const escrow = ESCROW_RAILS.has(approval.rail);
  /** An escrow with buyer acceptance holds a delivered job in review until the buyer acts or the window passes. */
  const reviewing = job.reviewEndsAt !== undefined || job.ended !== undefined;
  const active: JobStep | null =
    job.step === "funding"
      ? "held"
      : job.step === "held"
        ? "delivered"
        : job.step === "delivered"
          ? reviewing
            ? "review"
            : "released"
          : job.step === "review"
            ? "review"
            : job.step === "accepted"
              ? "released"
              : job.step === "disputed"
                ? "refunded"
                : null;
  const reviewLabel =
    job.ended === "accepted" ? "Accepted" : job.ended === "disputed" ? "Disputed" : job.ended === "elapsed" ? "Nobody disputed" : "In review";
  const STEPS: Array<{ id: JobStep; label: string }> = [
    { id: "countersigned", label: "Countersigned" },
    { id: "held", label: escrow ? "In escrow" : "Paid" },
    { id: "delivered", label: "Delivered" },
    ...(reviewing ? [{ id: "review" as const, label: reviewLabel }] : []),
    job.ended === "disputed"
      ? { id: "refunded", label: "Refunding your agent" }
      : { id: "released", label: job.ended === "elapsed" ? "Released after the window" : escrow ? "Released" : "Settled" },
  ];
  const reviewAt = job.times.accepted ?? job.times.disputed ?? (job.ended === "elapsed" ? job.reviewEndsAt : undefined);

  return (
    <ol className="ledger" aria-label="Progress" aria-live="polite">
      {STEPS.map((s) => {
        const at = s.id === "review" ? reviewAt : job.times[s.id];
        const isDone = at !== undefined;
        const isActive = active === s.id;
        return (
          <li
            key={s.id}
            className={cx(
              "ledger__step",
              `ledger__step--${s.id}`,
              isDone && "is-done",
              isActive && "is-active",
              s.id === "review" && job.ended === "disputed" && "is-disputed",
            )}
          >
            <span className="ledger__marker" aria-hidden="true" />
            <span className="ledger__label">{s.label}</span>
            <span className="ledger__detail">
              {isDone && s.id === "held" ? <Amount money={usd(approval.amount, approval.rail)} size="sm" flight /> : null}
              {isActive && s.id === "held"
                ? job.slow
                  ? "No payment yet. Your agent may have stopped waiting."
                  : escrow
                    ? "Funding the escrow"
                    : "Paying"
                : null}
              {isActive && s.id === "delivered" ? "Waiting for delivery" : null}
              {isActive && s.id === "review" && job.reviewEndsAt !== undefined ? <Countdown until={job.reviewEndsAt} /> : null}
              {isActive && s.id === "released" ? (job.ended === "accepted" ? "Releasing" : "Checking the output") : null}
              {isActive && s.id === "refunded" ? "Refunding" : null}
              {isDone && s.id !== "held" ? <span className="num">{formatClock(at)}</span> : null}
            </span>
            {isActive && s.id === "review" ? (
              <span className="ledger__sub ledger__note">Releases to the seller on its own when the window closes, unless you dispute.</span>
            ) : null}
            {isDone && s.id === "held" && job.fundTx ? (
              <span className="ledger__sub">
                <Hash value={job.fundTx} label="funding transaction" />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Outcome({ job, approval, onClose }: { job: JobView; approval: Approval; onClose: () => void }) {
  const signed = usd(approval.amount, approval.rail);
  const escrow = ESCROW_RAILS.has(approval.rail);
  if (job.step === "failed") {
    return (
      <div className="outcome outcome--refused" role="status">
        <p className="outcome__title">Not released.</p>
        <p className="outcome__body">{job.reason}</p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  if (job.step === "refused") {
    return (
      <div className="outcome outcome--refused" role="status">
        <p className="outcome__title">Refused. The price moved after you signed.</p>
        <div className="seam" aria-label="What you signed beside what the settlement tried to move">
          <div className="seam__half">
            <span className="seam__label">You signed</span>
            <Amount money={signed} size="lg" />
          </div>
          <div className="seam__half seam__half--seal">
            <span className="seam__label">Settlement tried</span>
            <Amount money={usd(job.asked ?? approval.amount, approval.rail)} size="lg" />
          </div>
        </div>
        <p className="outcome__body">The escrow pays only the amount you countersigned, so the chain reverted it. Nothing moved.</p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  if (job.step === "refunded" && job.ended === "disputed") {
    return (
      <div className="outcome outcome--refused" role="status">
        <p className="outcome__title">Disputed, so refunded.</p>
        <p className="outcome__body">
          <Amount money={signed} size="sm" /> is back with your agent. The seller’s bond is not touched: a dispute is not a failed
          delivery.
        </p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  if (job.step === "refunded") {
    return (
      <div className="outcome outcome--neutral" role="status">
        <p className="outcome__title">Refunded. The deadline passed.</p>
        <p className="outcome__body">
          <Amount money={signed} size="sm" /> is back with your agent. Anyone could send the refund once the deadline passed,
          and no one had to ask.
        </p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="outcome outcome--settled" role="status">
      <p className="outcome__title">
        {job.ended === "accepted"
          ? "Accepted and released. Slip minted."
          : job.ended === "elapsed"
            ? "Released after the window. Slip minted."
            : escrow
              ? "Released. Slip minted."
              : "Settled. Slip minted."}
      </p>
      <p className="outcome__body">
        {job.ended === "accepted"
          ? "You accepted the delivery, so the escrow paid the seller. The slip proves it without the hub."
          : job.ended === "elapsed"
            ? "Nobody disputed inside the window, so the escrow paid the seller. The slip proves it without the hub."
            : escrow
              ? "The seller was paid once the output matched the schema. The slip proves it without the hub."
              : "Paid, and the output matched the schema. The slip proves it without the hub."}
      </p>
      <div className="outcome__buttons">
        {job.slipHash ? (
          <Link to={`/slip/${job.slipHash}`} className="btn btn--primary btn--block">
            View the slip
          </Link>
        ) : null}
        <Button variant="secondary" block onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
