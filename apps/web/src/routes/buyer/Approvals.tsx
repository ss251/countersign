import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkEnvelope } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { playJob, type JobView, type Resource, type Scenario } from "../../lib/api.ts";
import { formatAmount, formatClock, formatDuration, formatMoney, nowUnix, RAIL_LABEL, remainingAtomic, usd } from "../../lib/format.ts";
import type { Approval, EnvelopeView } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, cx, Empty, Hash, KV, Tag } from "../../ui/primitives.tsx";

interface Props {
  approvals: Resource<Approval[]>;
  envelope: Resource<EnvelopeView>;
  query: URLSearchParams;
}

export function Approvals({ approvals, envelope, query }: Props) {
  const [closed, setClosed] = useState<string[]>([]);
  const waiting = (approvals.data ?? []).filter((a) => !closed.includes(a.id));
  const current = waiting[0];

  if (approvals.loading && !approvals.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;

  if (!current || !envelope.data) {
    const ask = envelope.data ? formatMoney(usd(envelope.data.askAbove)) : "your limit";
    return (
      <Empty title="Nothing is waiting for you.">
        Your agent buys inside the envelope on its own and asks you only above {ask}.{" "}
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
      onClose={() => setClosed((c) => [...c, current.id])}
    />
  );
}

function ApprovalFlow({
  approval,
  view,
  scenario,
  onClose,
}: {
  approval: Approval;
  view: EnvelopeView;
  scenario: Scenario;
  onClose: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const { listing } = approval;
  const { offer } = listing;
  const money = usd(approval.amount, approval.rail);
  const checks = envelopeChecks(view, approval);
  const decision = checkEnvelope(
    view.envelope,
    view.spent,
    { seller: offer.seller, offerHash: listing.hash, amount: approval.amount },
    nowUnix(),
  );
  const final = job && (job.step === "released" || job.step === "refused" || job.step === "refunded");

  useEffect(() => () => stop.current?.(), []);

  return (
    <article className="approval" aria-labelledby="approval-title">
      <header className="approval__head">
        <p className="approval__who">
          <span className="approval__agent">{approval.agentName}</span> wants to buy
        </p>
        <div className="approval__title-row">
          <h1 id="approval-title" className="approval__title">
            {offer.title}
          </h1>
          <Tag>{offer.adapter}</Tag>
        </div>
        <p className="approval__summary">{offer.summary}</p>
        {offer.upstream ? (
          <p className="approval__source">
            From{" "}
            <a href={offer.upstream.url} target="_blank" rel="noreferrer">
              {upstreamLabel(offer.upstream.url)}
            </a>
            , found through {approval.discoveredVia === "circle" ? "Circle discovery" : "the countersign registry"}
          </p>
        ) : null}
      </header>

      <div className="approval__price">
        <Amount money={money} size="xl" />
        <p className="approval__to">
          to <span className="approval__seller">{listing.seller.name}</span>{" "}
          <Hash value={offer.seller} label="seller address" copy={false} />
        </p>
      </div>

      {job ? null : (
        <>
          <KV
            className="approval__terms"
            rows={[
              ["Deadline", <span className="num">{formatDuration(offer.deadline)}, then anyone can refund</span>],
              ["Seller bond", <Amount money={usd(offer.bond, approval.rail)} size="sm" />],
              ["Rail", RAIL_LABEL[approval.rail]],
              ["Offer hash", <Hash value={listing.hash} label="offer hash" />],
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
            {decision.ok ? null : <p className="checks__refusal">{decision.message}</p>}
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
              ariaLabel={`Countersign ${formatMoney(money)} to ${offer.title}`}
              left={listing.seller.name}
              right="you"
              disabled={!decision.ok}
              signed={job !== null}
              label={decision.ok ? "Hold to countersign" : "The envelope refuses this call"}
              onSigned={() => {
                stop.current = playJob(approval, scenario, setJob);
              }}
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

function upstreamLabel(url: string): string {
  const gh = url.match(/github\.com\/([^/]+\/[^/#?]+)/);
  if (gh) return gh[1]!;
  const npm = url.match(/npmjs\.com\/package\/(.+)$/);
  if (npm) return npm[1]!;
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

type CheckKind = "pass" | "fail" | "ask";

/**
 * Each envelope rule on its own line, so the human sees why, not only whether.
 * Same semantics as checkEnvelope in core: an empty allowlist means any seller,
 * and a per-seller override beats the default limit.
 */
function envelopeChecks(view: EnvelopeView, a: Approval): Array<{ kind: CheckKind; text: ReactNode }> {
  const { envelope: env, spent } = view;
  const seller = a.listing.offer.seller.toLowerCase();
  const amount = BigInt(a.amount);
  const capLeft = remainingAtomic(env.cap, spent.total);
  const limit = env.merchantLimits?.[seller] ?? env.perMerchant;
  const sellerLeft = remainingAtomic(limit, spent.bySeller[seller] ?? "0");
  const allowed =
    env.allowlist.length === 0 ||
    env.allowlist.some((e) => e.toLowerCase() === seller || e.toLowerCase() === a.listing.hash.toLowerCase());
  const n = (atomic: string) => <span className="num">{formatAmount(usd(atomic))}</span>;
  const out: Array<{ kind: CheckKind; text: ReactNode }> = [];
  if (env.revoked) out.push({ kind: "fail", text: "The envelope is revoked" });
  out.push(
    amount <= BigInt(capLeft)
      ? { kind: "pass", text: <>Inside the budget, {n(capLeft)} left</> }
      : { kind: "fail", text: <>Over the budget, {n(capLeft)} left</> },
  );
  out.push(
    amount <= BigInt(sellerLeft)
      ? { kind: "pass", text: <>Inside the limit for {a.listing.seller.name}, {n(sellerLeft)} left</> }
      : { kind: "fail", text: <>Over the limit for {a.listing.seller.name}, {n(sellerLeft)} left</> },
  );
  out.push(
    allowed
      ? { kind: "pass", text: env.allowlist.length === 0 ? "Any seller is allowed" : `${a.listing.seller.name} is on your allowlist` }
      : { kind: "fail", text: `${a.listing.seller.name} is not on your allowlist` },
  );
  if (amount > BigInt(view.askAbove)) {
    out.push({ kind: "ask", text: <>Above {n(view.askAbove)}, so it waits for you</> });
  }
  return out;
}

function CheckGlyph({ kind }: { kind: CheckKind }) {
  if (kind === "pass") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Passes:">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "fail") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Refused:">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Needs you:">
      <circle cx="8" cy="8" r="2.4" fill="currentColor" />
    </svg>
  );
}

/* After the hold: what has happened, in order, to the second. */

const STEPS = [
  { id: "countersigned", label: "Countersigned" },
  { id: "held", label: "In escrow" },
  { id: "delivered", label: "Delivered" },
  { id: "released", label: "Released" },
] as const;

function JobLedger({ job, approval }: { job: JobView; approval: Approval }) {
  if (job.step === "refused" || job.step === "refunded") return null;
  const active = job.step === "funding" ? "held" : job.step === "held" ? "delivered" : job.step === "delivered" ? "released" : null;

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
              {isDone && s.id === "held" ? <Amount money={usd(approval.amount, approval.rail)} size="sm" /> : null}
              {isActive && s.id === "held" ? "Funding the escrow" : null}
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
      <div className="outcome outcome--settled" role="status">
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
      <p className="outcome__title">Released. Slip minted.</p>
      <p className="outcome__body">The seller was paid once the output matched the schema. The slip proves it without the hub.</p>
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
