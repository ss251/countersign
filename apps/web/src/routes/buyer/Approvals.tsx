import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { checkEnvelope, type EnvelopeDecision } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, followJob, playJob, type JobView, type Resource, type Scenario } from "../../lib/api.ts";
import {
  ESCROW_RAILS,
  formatAmount,
  formatClock,
  formatDuration,
  formatMoney,
  nowUnix,
  RAIL_LABEL,
  remainingAtomic,
  shortHex,
  usd,
} from "../../lib/format.ts";
import { approvalToken, HubError, rememberApprovalToken } from "../../lib/hub.ts";
import { envelopeChecklist, type Check } from "../../lib/checklist.ts";
import type { Approval, EnvelopeView } from "../../lib/types.ts";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, cx, Empty, Hash, Tag } from "../../ui/primitives.tsx";

interface Props {
  approvals: Resource<Approval[]>;
  envelope: Resource<EnvelopeView>;
  query: URLSearchParams;
  onSigned: (a: Approval) => void;
  onSettled: (a: Approval, job: JobView) => void;
  onClose: (a: Approval) => void;
}

export function Approvals({ approvals, envelope, query, onSigned, onSettled, onClose }: Props) {
  const current = approvals.data?.[0];

  if (approvals.loading && !approvals.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  if (!current || !envelope.data) {
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
      view={envelope.data}
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
  view: EnvelopeView;
  scenario: Scenario;
  onSigned: () => void;
  onSettled: (job: JobView) => void;
  onClose: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const stop = useRef<(() => void) | null>(null);
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
  const blind = live && seen.mirror === undefined;
  const checks = blind
    ? AGENT_CHECKED
    : envelopeChecklist(seen, { seller: offer.seller, offerHash: listing.hash, amount: approval.amount, sellerName: listing.seller.name });
  const decision: EnvelopeDecision = blind
    ? { ok: true }
    : checkEnvelope(seen.envelope, seen.spent, { seller: offer.seller, offerHash: listing.hash, amount: approval.amount }, nowUnix());
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
      stop.current = playJob(approval, scenario, setJob);
      return;
    }
    setSending("countersign");
    setProblem(null);
    try {
      const known = await api.jobIds(approval.agent!);
      await api.decide(approval.id, "countersign");
      onSigned();
      stop.current = followJob(approval, known, setJob);
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

  useEffect(() => () => stop.current?.(), []);
  useEffect(() => {
    if (final && job) onSettledRef.current(job);
    // Report each final step once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);

  const left = remainingAtomic(seen.envelope.cap, seen.spent.total);
  const slip = job?.step === "released" ? job.slipHash : undefined;

  return (
    <article className="approval" aria-labelledby="approval-title">
      <p className="approval__ask">
        <span className="approval__agent">{approval.agentName}</span> asks you to countersign
        {live ? <span className="num"> · {formatClock(approval.requestedAt)}</span> : null}
      </p>

      {/* The purchase, as a pass: who pays whom, for what, exactly how much, and the stub that becomes the slip. */}
      <section className={cx("pass", slip && "pass--slipped")} aria-label="The purchase">
        <div className="pass__ends">
          <div className="pass__end">
            <span className="label">Agent</span>
            <span className="pass__who mono">{approval.agentName}</span>
            <span className="pass__sub num">{blind ? "Checked its own envelope" : `${formatAmount(usd(left))} left in the envelope`}</span>
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
            <Tag>{offer.adapter}</Tag>
          </div>
          <p className="pass__summary">{offer.summary}</p>
          {offer.upstream ? (
            <p className="pass__source">
              From{" "}
              <a href={offer.upstream.url} target="_blank" rel="noreferrer">
                {upstreamLabel(offer.upstream.url)}
              </a>
              , found through {approval.discoveredVia === "circle" ? "Circle discovery" : "the countersign registry"}
            </p>
          ) : null}
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
              <div className="pass__span2">
                <dt className="label">Seller gets</dt>
                <dd>
                  <Amount money={usd(toll.net, approval.rail)} size="sm" />
                </dd>
              </div>
            </>
          ) : null}
          <div className="pass__span3">
            <dt className="label">Offer hash</dt>
            <dd>
              <Hash value={listing.hash} head={12} tail={10} label="offer hash" />
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
          <p className="approval__dock-line">
            <span className="approval__dock-to">To {listing.seller.named === false ? "an unnamed seller" : listing.seller.name}</span>
            <Amount money={money} size="sm" flight />
          </p>
          {problem ? (
            <p className="approval__problem" role="alert">
              {problem}
            </p>
          ) : null}
          {live && !token ? (
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
          {job ? null : (
            <Button variant="quiet" block className="approval__decline" disabled={sending !== null} onClick={() => void decline()}>
              {sending === "decline" ? "Declining" : "Decline"}
            </Button>
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
function TokenForm({ onSave }: { onSave: (token: string) => void }) {
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

/* After the hold: what has happened, in order, to the second. */

function JobLedger({ job, approval }: { job: JobView; approval: Approval }) {
  if (job.step === "refused" || job.step === "refunded" || job.step === "failed") return null;
  const active = job.step === "funding" ? "held" : job.step === "held" ? "delivered" : job.step === "delivered" ? "released" : null;
  const escrow = ESCROW_RAILS.has(approval.rail);
  const STEPS = [
    { id: "countersigned", label: "Countersigned" },
    { id: "held", label: escrow ? "In escrow" : "Paid" },
    { id: "delivered", label: "Delivered" },
    { id: "released", label: escrow ? "Released" : "Settled" },
  ] as const;

  return (
    <ol className="ledger" aria-label="Progress" aria-live="polite">
      {STEPS.map((s) => {
        const at = job.times[s.id];
        const isDone = at !== undefined;
        const isActive = active === s.id;
        return (
          <li key={s.id} className={cx("ledger__step", `ledger__step--${s.id}`, isDone && "is-done", isActive && "is-active")}>
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
              {isActive && s.id === "released" ? "Checking the output" : null}
              {isDone && s.id !== "held" ? <span className="num">{formatClock(at)}</span> : null}
            </span>
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
      <p className="outcome__title">{escrow ? "Released. Slip minted." : "Settled. Slip minted."}</p>
      <p className="outcome__body">
        {escrow
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
