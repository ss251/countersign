import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Slip } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDateTime, shortHex, usd } from "../../lib/format.ts";
import type { Listing, RailDeclaration, Settlement } from "../../lib/types.ts";
import { verifySlip, type Verdict } from "../../lib/verify.ts";
import { Amount, cx, Hash } from "../../ui/primitives.tsx";
import { heldBy } from "./field.ts";
import { span, toBeat, useBeat } from "./stage.ts";

/*
 * The third stage: one real escrow payment, followed through four steps from the hub's own records.
 *   0 "An offer is published.": its title, seller, offer hash and when it was issued.
 *   1 "A buyer countersigns it.": the buyer, the amount in flight and the job.
 *   2 "The money is held until the work lands.": the escrow and the job it holds.
 *   3 "The seller signs, and the slip verifies.": the slip and release, and the check run here.
 *   4 the exit: the four steps fade and the last statement holds as the proof comes up.
 * With no release, or a hub that did not answer, one honest sentence stands in place of the steps:
 * never a fixture and never a sample hash.
 */

/** The exit is 0.3 of a screen, as in the other stages: the last statement holds as the proof comes up. */
const WEIGHTS = [1, 1, 1, 1, 0.3] as const;
const EXIT = 4;
const SECTIONS = 4;
/** With nothing real to follow the stage pins as one beat, statement alone. */
const ONE = [1] as const;

const STATEMENTS = [
  "An offer is published.",
  "A buyer countersigns it.",
  "The money is held until the work lands.",
  "The seller signs, and the slip verifies.",
] as const;

const LABELS = ["Published", "Countersigned", "Held", "Verified"] as const;

const HUB_DOWN = "The hub did not answer, so there is no live payment to follow right now.";
const NO_RELEASE = "No escrow payment has cleared on this hub yet. The first one shows here, step by step.";


type StepState = "is-on" | "is-done" | "is-next" | "is-exit";

export interface LifecycleProps {
  /** The newest release from an escrow contract (escrowRelease): the same one stage two shows. */
  release: Settlement | undefined;
  rails: RailDeclaration[] | undefined;
  /** Some read the landing needs has never come back from the hub. */
  hubDown: boolean;
  pinned: boolean;
  narrow: boolean;
}

export function LifecycleStage({ release, rails, hubDown, pinned, narrow }: LifecycleProps) {
  const stage = useRef<HTMLElement>(null);
  const live = release !== undefined && !hubDown;
  const weights = live ? WEIGHTS : ONE;
  const beat = useBeat(stage, weights, pinned);
  const go = (b: number) => toBeat(stage.current, weights, b);

  // The hub's own records only: a read that came from fixtures is treated as no read at all.
  const listingRead = useResource(
    () =>
      release && !hubDown
        ? api.listing(release.offerHash)
        : Promise.resolve({ data: undefined, source: "absent" as const }),
    [release?.offerHash, hubDown],
  );
  const listing = !listingRead.loading && listingRead.source === "hub" ? listingRead.data : undefined;

  const slipRead = useResource(
    () =>
      release && !hubDown && release.slipHash
        ? api.slip(release.slipHash)
        : Promise.resolve({ data: undefined, source: "absent" as const }),
    [release?.slipHash, hubDown],
  );
  const slip = !slipRead.loading && slipRead.source === "hub" ? slipRead.data?.slip : undefined;

  // The same verifier the verify page runs, from the slip's own bytes. Its verdict is step 4's word.
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  useEffect(() => {
    setVerdict(null);
    if (!slip) return;
    let alive = true;
    void verifySlip(slip).then((v) => {
      if (alive) setVerdict(v);
    });
    return () => {
      alive = false;
    };
  }, [slip]);

  if (!release || hubDown) {
    return (
      <section
        ref={stage}
        className={cx("story", pinned ? "story--pinned" : "story--static", "story--life")}
        style={pinned ? ({ "--span": span(ONE) } as CSSProperties) : undefined}
        aria-label="The life of one payment"
      >
        <div className="story__frame" data-beat={0}>
          <div className="story__box">
            <h2 className="story__line is-on">{hubDown ? HUB_DOWN : NO_RELEASE}</h2>
          </div>
        </div>
      </section>
    );
  }

  if (!pinned) {
    return (
      <section ref={stage} className="story story--static story--life" aria-label="The life of one payment">
        {Array.from({ length: SECTIONS }, (_, b) => (
          <LifecycleFrame
            key={b}
            release={release}
            rails={rails}
            narrow={narrow}
            listing={listing}
            slip={slip}
            verdict={verdict}
            beat={b}
            only
            go={go}
          />
        ))}
      </section>
    );
  }

  return (
    <section
      ref={stage}
      className="story story--pinned story--life"
      style={{ "--span": span(WEIGHTS) } as CSSProperties}
      aria-label="The life of one payment"
    >
      <LifecycleFrame
        release={release}
        rails={rails}
        narrow={narrow}
        listing={listing}
        slip={slip}
        verdict={verdict}
        beat={beat}
        only={false}
        go={go}
      />
    </section>
  );
}

interface FrameProps {
  release: Settlement;
  rails: RailDeclaration[] | undefined;
  narrow: boolean;
  listing: Listing | undefined;
  slip: Slip | undefined;
  verdict: Verdict | null;
  beat: number;
  only: boolean;
  go: (beat: number) => void;
}

function LifecycleFrame({ release, rails, narrow, listing, slip, verdict, beat, only, go }: FrameProps) {
  const on = (b: number) => beat === b;
  const shows = (b: number) => !only || beat === b;
  // Keyboard focus that lands in a step brings its beat into view, so nothing focusable is ever unseen.
  const bring = (b: number) => () => {
    if (!only && !on(b)) go(b);
  };
  const state = (i: number): StepState => (beat === EXIT ? "is-exit" : i < beat ? "is-done" : i === beat ? "is-on" : "is-next");

  // Everything about where the money waited comes from this payment's own records: the slip the seller
  // signed names its escrow, and the settlement its network. Its rail's declaration fills in only what
  // the slip has not loaded yet. Never another rail's contract or chain.
  const own = heldBy(release, rails, slip);
  const buyer = release.buyer ?? slip?.body.buyer;

  return (
    <div className="story__frame" data-beat={beat}>
      <div className="story__box">
        {shows(0) ? <h2 className={cx("story__line", on(0) && "is-on")}>{STATEMENTS[0]}</h2> : null}
        {shows(1) ? <h2 className={cx("story__line", on(1) && "is-on")}>{STATEMENTS[1]}</h2> : null}
        {shows(2) ? <h2 className={cx("story__line", on(2) && "is-on")}>{STATEMENTS[2]}</h2> : null}
        {shows(3) ? (
          <h2 className={cx("story__line", (on(3) || beat === EXIT) && "is-on")}>{STATEMENTS[3]}</h2>
        ) : null}
        <div className="story__life">
          <ol className="life" aria-label="The four steps">
            <LifeStep state={state(0)} n={1} label={LABELS[0]} onFocus={bring(0)}>
              <dl className="story__lines story__lines--two">
                <div className="story__wide">
                  <dt className="label">Offer</dt>
                  <dd>{(listing?.offer.title ?? release.title) || "Untitled offer"}</dd>
                </div>
                <div>
                  <dt className="label">Seller</dt>
                  <dd>{listing?.seller.name ?? shortHex(release.seller)}</dd>
                </div>
                <div>
                  <dt className="label">Offer hash</dt>
                  <dd>
                    <Hash value={release.offerHash} label="offer hash" copy={false} />
                  </dd>
                </div>
                {listing ? (
                  <div>
                    <dt className="label">Published</dt>
                    <dd className="mono">{formatDateTime(listing.offer.issuedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </LifeStep>

            <LifeStep state={state(1)} n={2} label={LABELS[1]} onFocus={bring(1)}>
              <dl className="story__lines story__lines--two">
                {buyer ? (
                  <div>
                    <dt className="label">Buyer</dt>
                    <dd>
                      <Hash value={buyer} label="buyer" copy={false} />
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="label">Amount</dt>
                  <dd>
                    <Amount money={usd(release.amount, release.rail)} size={narrow ? "lg" : "sm"} flight />
                  </dd>
                </div>
                <div className="story__wide">
                  <dt className="label">Job</dt>
                  <dd>
                    <Hash value={release.jobId} label="job" copy={false} />
                  </dd>
                </div>
              </dl>
            </LifeStep>

            <LifeStep state={state(2)} n={3} label={LABELS[2]} onFocus={bring(2)}>
              <dl className="story__lines story__lines--two">
                {own.escrow ? (
                  <div>
                    <dt className="label">Escrow</dt>
                    <dd>
                      <Hash value={own.escrow} href={own.escrowHref} label="escrow address" copy={false} />
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="label">Job</dt>
                  <dd>
                    <Hash value={release.jobId} label="job" copy={false} />
                  </dd>
                </div>
              </dl>
              <p className="story__quiet life__quiet">
                {`Held on ${own.chain} by the escrow contract until the output checks out.`}
              </p>
            </LifeStep>

            <LifeStep state={state(3)} n={4} label={LABELS[3]} onFocus={bring(3)}>
              <dl className="story__lines story__lines--two">
                {release.slipHash ? (
                  <div>
                    <dt className="label">Slip</dt>
                    <dd>
                      <Hash value={release.slipHash} label="slip hash" copy={false} />
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="label">Release</dt>
                  <dd>
                    <Hash value={release.tx} href={own.txHref} tx label="release transaction" />
                  </dd>
                </div>
                <div className="story__wide">
                  <dt className="label">Check</dt>
                  <dd>{checkWord(verdict)}</dd>
                </div>
              </dl>
              {release.slipHash ? (
                <Link to={`/verify/${release.slipHash}`} className="story__go">
                  Check it without us
                </Link>
              ) : null}
            </LifeStep>
          </ol>
        </div>
      </div>
    </div>
  );
}

function LifeStep({
  state,
  n,
  label,
  onFocus,
  children,
}: {
  state: StepState;
  n: number;
  label: string;
  onFocus: () => void;
  children: ReactNode;
}) {
  return (
    <li className={cx("life__step", state)} onFocus={onFocus}>
      <span className="life__n">
        {`0${n}`}
        {state === "is-done" ? " ✓" : ""}
      </span>
      <span className="life__label">{label}</span>
      {children}
    </li>
  );
}

/** Step 4's word: the verifier's verdict, or that it is still running. */
function checkWord(verdict: Verdict | null): ReactNode {
  if (!verdict) return <span className="story__quiet">Checking…</span>;
  if (verdict.valid) return <span className="status status--released">Verified in this browser</span>;
  const failed = verdict.checks.find((c) => c.state === "fail");
  return <span className="story__quiet">Not verified: {failed?.detail ?? "the slip did not check."}</span>;
}
