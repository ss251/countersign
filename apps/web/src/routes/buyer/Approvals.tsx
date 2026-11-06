import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../../app/router.tsx";
import { playJob, type JobView, type Resource, type Scenario } from "../../lib/api.ts";
import { formatAmount, formatDuration, formatMoney, formatTime, RAIL_LABEL, remaining } from "../../lib/format.ts";
import type { Approval, Envelope } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, cx, Empty, Hash, KV, Tag } from "../../ui/primitives.tsx";

interface Props {
  approvals: Resource<Approval[]>;
  envelope: Resource<Envelope>;
  query: URLSearchParams;
}

export function Approvals({ approvals, envelope, query }: Props) {
  const [done, setDone] = useState<string[]>([]);
  const waiting = (approvals.data ?? []).filter((a) => !done.includes(a.id));
  const current = waiting[0];

  if (approvals.loading && !approvals.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  if (!current || !envelope.data) {
    const ask = envelope.data ? formatMoney(envelope.data.askAbove) : "your limit";
    return (
      <Empty title="Nothing is waiting for you.">
        Your agent buys inside the envelope on its own and asks you only above {ask}.{" "}
        <Link to="/buyer?tab=history">See what it bought</Link>.
      </Empty>
    );
  }

  const scenario = (["moved", "deadline"].includes(query.get("scenario") ?? "") ? query.get("scenario") : "release") as Scenario;

  return (
    <ApprovalFlow
      key={current.id}
      approval={current}
      envelope={envelope.data}
      scenario={scenario}
      onClose={() => setDone((d) => [...d, current.id])}
    />
  );
}

function ApprovalFlow({
  approval,
  envelope,
  scenario,
  onClose,
}: {
  approval: Approval;
  envelope: Envelope;
  scenario: Scenario;
  onClose: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const { offer } = approval;
  const checks = envelopeChecks(envelope, approval);
  const blocked = checks.some((c) => c.kind === "fail");
  const final = job && (job.step === "released" || job.step === "refused" || job.step === "refunded");

  useEffect(() => () => stop.current?.(), []);

  const sign = () => {
    stop.current = playJob(approval, scenario, setJob);
  };

  return (
    <article className="approval" aria-labelledby="approval-title">
      <header className="approval__head">
        <p className="approval__who">
          <span className="approval__agent">{approval.agent}</span> wants to buy
        </p>
        <div className="approval__title-row">
          <h1 id="approval-title" className="approval__title">
            {offer.name}
          </h1>
          <Tag>{offer.adapter}</Tag>
        </div>
        <p className="approval__summary">{offer.summary}</p>
        <p className="approval__source">
          From{" "}
          <a href={offer.upstream.url} target="_blank" rel="noreferrer">
            {offer.upstream.label}
          </a>
          , found through {approval.discoveredVia === "circle" ? "Circle discovery" : "the countersign registry"}
        </p>
      </header>

      <div className="approval__price">
        <Amount money={approval.amount} size="xl" />
        <p className="approval__to">
          to <span className="approval__seller">{offer.seller.name}</span>{" "}
          <Hash value={offer.seller.address} label="seller address" copy={false} />
        </p>
      </div>

      {job ? null : (
        <>
          <KV
            className="approval__terms"
            rows={[
              ["Deadline", <span className="num">{formatDuration(offer.deadlineSeconds)}, then anyone can refund</span>],
              ["Seller bond", <Amount money={offer.bond} size="sm" />],
              ["Rail", RAIL_LABEL[approval.rail]],
              ["Offer hash", <Hash value={offer.hash} label="offer hash" />],
            ]}
          />

          <section className="checks" aria-label="Envelope checks">
            <h2 className="checks__title">Envelope</h2>
            <ul className="checks__list">
              {checks.map((c, i) => (
                <li key={i} className={cx("check", `check--${c.kind}`)}>
                  <CheckGlyph kind={c.kind} />
                  <span className="check__text">{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {job ? <JobLedger job={job} approval={approval} /> : null}

      <div className="approval__actions">
        {final ? (
          <Outcome job={job!} approval={approval} onClose={onClose} />
        ) : (
          <>
            <HoldToSign
              ariaLabel={`Countersign ${formatMoney(approval.amount)} to ${offer.name}`}
              left={offer.seller.name}
              right="you"
              disabled={blocked}
              signed={job !== null}
              label={blocked ? "The envelope refuses this call" : "Hold to countersign"}
              onSigned={sign}
            />
            {job ? null : (
              <Button variant="quiet" block onClick={onClose}>
                Decline
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

type CheckKind = "pass" | "fail" | "ask";

function envelopeChecks(env: Envelope, a: Approval): Array<{ kind: CheckKind; text: ReactNode }> {
  const amount = BigInt(a.amount.amount);
  const left = remaining(env.cap, env.spent);
  const allowed = env.allowlist.some((s) => s.address.toLowerCase() === a.offer.seller.address.toLowerCase());
  const out: Array<{ kind: CheckKind; text: ReactNode }> = [];
  if (env.revoked) out.push({ kind: "fail", text: "The envelope is revoked. Issue a new one to buy." });
  out.push(
    amount <= BigInt(left.amount)
      ? { kind: "pass", text: <>Inside today's cap, <span className="num">{formatAmount(left)}</span> left</> }
      : { kind: "fail", text: <>Over today's cap, <span className="num">{formatAmount(left)}</span> left</> },
  );
  out.push(
    amount <= BigInt(env.perMerchant.amount)
      ? { kind: "pass", text: <>Under the per-seller limit of <span className="num">{formatAmount(env.perMerchant)}</span></> }
      : { kind: "fail", text: <>Over the per-seller limit of <span className="num">{formatAmount(env.perMerchant)}</span></> },
  );
  out.push(
    allowed
      ? { kind: "pass", text: `${a.offer.seller.name} is on your allowlist` }
      : { kind: "fail", text: `${a.offer.seller.name} is not on your allowlist` },
  );
  if (amount > BigInt(env.askAbove.amount)) {
    out.push({ kind: "ask", text: <>Above <span className="num">{formatAmount(env.askAbove)}</span>, so it waits for you</> });
  }
  return out;
}

function CheckGlyph({ kind }: { kind: CheckKind }) {
  if (kind === "pass") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" aria-label="Passes">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "fail") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" aria-label="Refused">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" aria-label="Needs you">
      <circle cx="8" cy="8" r="2.4" fill="currentColor" />
    </svg>
  );
}

/* After the hold: what has happened, in order, with the times. */

const STEPS: Array<{ id: "countersigned" | "held" | "delivered" | "released"; label: string }> = [
  { id: "countersigned", label: "Countersigned" },
  { id: "held", label: "In escrow" },
  { id: "delivered", label: "Delivered" },
  { id: "released", label: "Released" },
];

function JobLedger({ job, approval }: { job: JobView; approval: Approval }) {
  if (job.step === "refused" || job.step === "refunded") return null;
  const reached = (id: string) => Boolean(job.times[id as keyof JobView["times"]]);
  const active = job.step === "funding" ? "held" : job.step === "held" ? "delivered" : job.step === "delivered" ? "released" : null;

  return (
    <ol className="ledger" aria-label="Progress">
      {STEPS.map((s) => {
        const isDone = reached(s.id);
        const isActive = active === s.id;
        return (
          <li key={s.id} className={cx("ledger__step", `ledger__step--${s.id}`, isDone && "is-done", isActive && "is-active")}>
            <span className="ledger__marker" aria-hidden="true" />
            <span className="ledger__label">{s.label}</span>
            <span className="ledger__detail">
              {isDone && s.id === "held" ? <Amount money={approval.amount} size="sm" /> : null}
              {isActive && s.id === "held" ? "Funding the escrow" : null}
              {isActive && s.id === "delivered" ? "Waiting for delivery" : null}
              {isActive && s.id === "released" ? "Output matches the schema" : null}
              {isDone && s.id !== "held" ? <span className="num">{formatTime(job.times[s.id]!)}</span> : null}
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
  if (job.step === "refused") {
    return (
      <div className="outcome outcome--refused" role="status">
        <p className="outcome__title">Refused. The price moved after you signed.</p>
        <div className="seam" aria-label="What was signed against what was asked">
          <div className="seam__half">
            <span className="seam__label">You signed</span>
            <Amount money={approval.amount} size="lg" />
          </div>
          <div className="seam__half seam__half--seal">
            <span className="seam__label">The seller settled at</span>
            <Amount money={job.asked ?? approval.amount} size="lg" />
          </div>
        </div>
        <p className="outcome__body">The escrow only pays the amount you countersigned, so the chain reverted it. Nothing moved.</p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  if (job.step === "refunded") {
    return (
      <div className="outcome outcome--settled" role="status">
        <p className="outcome__title">Refunded. The deadline passed.</p>
        <p className="outcome__body">
          <Amount money={approval.amount} size="sm" /> is back in your envelope. Anyone could send the refund once the
          deadline passed. No one had to ask.
        </p>
        <Button variant="primary" block onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="outcome outcome--settled" role="status">
      <p className="outcome__title">Released. Slip minted.</p>
      <p className="outcome__body">The seller was paid when the output checked out. The slip proves it without the hub.</p>
      <div className="outcome__buttons">
        {job.slipId ? (
          <Link to={`/slip/${job.slipId}`} className="btn btn--primary btn--block">
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
