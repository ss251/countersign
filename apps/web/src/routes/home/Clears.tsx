import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { READING } from "./field.ts";
import { Link } from "../../app/router.tsx";
import { explorerTemplate, formatClock, networkName, RAIL_LABEL, usd } from "../../lib/format.ts";
import type { EnvelopeView, Listing, Settlement } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, cx, Hash } from "../../ui/primitives.tsx";
import { span, toBeat, useBeat, useHeight } from "./stage.ts";

/*
 * The second stage: how a purchase clears, as one artifact that changes state.
 *   0 "The agent signs its limits once.": the envelope, as plain lines.
 *   1 "Above them, you countersign the exact offer and amount.": the envelope steps back into a
 *     corner and the hold-to-countersign try-out takes the centre.
 *   2 "On the escrow rail, nothing moves until the output checks out.": the newest escrow release,
 *     and one quiet line for the direct rails, which settle before delivery.
 *   3 the exit: the envelope and the release leave together; the statement rides the frame away,
 *     so nothing is orphaned as the proof comes up.
 */

/** The exit is 0.3 of a screen, as in the first stage: the statement holds alone for about half a screen. */
const WEIGHTS = [1, 1, 1, 0.3] as const;
const EXIT = 3;

export interface ClearsProps {
  /** The agent's signed envelope when the hub serves one; otherwise the example stands in. */
  envelope: EnvelopeView | undefined;
  featured: Listing | undefined;
  /** The newest release from an escrow contract (escrowRelease): never a direct or held payment under the escrow claim. */
  release: Settlement | undefined;
  /** The other rails in plain words, from their declarations (otherRailsLines). */
  others: string[];
  /** The hub's first reads are still out: say so, never "none yet". */
  reading: boolean;
  pinned: boolean;
  narrow: boolean;
}

export function ClearsStage(props: ClearsProps) {
  const stage = useRef<HTMLElement>(null);
  const beat = useBeat(stage, WEIGHTS, props.pinned);
  const go = (b: number) => toBeat(stage.current, WEIGHTS, b);
  if (!props.pinned) {
    return (
      <section ref={stage} className="story story--static story--clears" aria-label="How a purchase clears">
        {Array.from({ length: EXIT }, (_, b) => (
          <ClearsFrame key={b} {...props} beat={b} only go={go} />
        ))}
      </section>
    );
  }
  return (
    <section
      ref={stage}
      className="story story--pinned story--clears"
      style={{ "--span": span(WEIGHTS) } as CSSProperties}
      aria-label="How a purchase clears"
    >
      <ClearsFrame {...props} beat={beat} only={false} go={go} />
    </section>
  );
}

function ClearsFrame({
  beat,
  only,
  go,
  envelope,
  featured,
  release,
  others,
  reading,
  narrow,
}: ClearsProps & { beat: number; only: boolean; go: (beat: number) => void }) {
  const env = useRef<HTMLDivElement>(null);
  const envHeight = useHeight(env);
  const shows = (b: number) => !only || beat === b;
  const on = (b: number) => beat === b;
  const bring = (b: number) => () => {
    if (!only && !on(b)) go(b);
  };
  return (
    <div className="story__frame" data-beat={beat}>
      <div className="story__box">
        {shows(0) ? <h2 className={cx("story__line", on(0) && "is-on")}>The agent signs its limits once.</h2> : null}
        {shows(1) ? <h2 className={cx("story__line", on(1) && "is-on")}>Above them, you countersign the exact offer and amount.</h2> : null}
        {shows(2) ? (
          <h2 className={cx("story__line", (on(2) || beat === EXIT) && "is-on")}>
            On the escrow rail, nothing moves until the output checks out.
          </h2>
        ) : null}
        <div className="story__desk" style={{ "--env-h": `${envHeight}px` } as CSSProperties}>
          <Envelope view={envelope} back={beat >= 1} gone={beat >= EXIT} box={env} />
          {shows(1) ? <TryOut listing={featured} on={on(1)} onFocus={bring(1)} narrow={narrow} /> : null}
          {shows(2) ? <Release s={release} others={others} reading={reading} on={on(2)} onFocus={bring(2)} narrow={narrow} /> : null}
        </div>
      </div>
    </div>
  );
}

/*
 * The envelope as plain lines. Until the hub serves an agent's own, the example: its four fields
 * in words, with no amount, agent or time, so it never reads as a record. The real one replaces
 * it field for field.
 */
function Envelope({
  view,
  back,
  gone,
  box,
}: {
  view: EnvelopeView | undefined;
  back: boolean;
  gone: boolean;
  box: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={box} className={cx("story__env", back && "is-back", gone && "is-gone")}>
      {view ? (
        <>
          <p className="label">
            Signed envelope
            {view.mirror ? (
              <span className="story__meta">
                {" "}
                · {view.agentName} · {formatClock(view.mirror.signedAt)}
              </span>
            ) : null}
          </p>
          <dl className="story__lines">
            <div>
              <dt className="label">Budget</dt>
              <dd>
                <Amount money={usd(view.envelope.cap)} size="sm" /> <span className="story__quiet">· spent</span>{" "}
                <Amount money={usd(view.spent.total)} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="label">Cap per seller</dt>
              <dd>
                <Amount money={usd(view.envelope.perMerchant)} size="sm" />
              </dd>
            </div>
            <div>
              <dt className="label">Allowlist</dt>
              <dd>
                {view.envelope.allowlist.length === 0
                  ? "Any seller"
                  : `${view.envelope.allowlist.length} ${view.envelope.allowlist.length === 1 ? "seller" : "sellers"}`}
              </dd>
            </div>
            <div>
              <dt className="label">Ask above</dt>
              <dd>{view.askAbove === null ? "Never" : <Amount money={usd(view.askAbove)} size="sm" />}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="label">Example envelope</p>
          <dl className="story__lines">
            <div>
              <dt className="label">Budget</dt>
              <dd>The most it spends in all</dd>
            </div>
            <div>
              <dt className="label">Cap per seller</dt>
              <dd>The most any one seller gets</dd>
            </div>
            <div>
              <dt className="label">Allowlist</dt>
              <dd>Only the sellers you name</dd>
            </div>
            <div>
              <dt className="label">Ask above</dt>
              <dd>Above this price, it asks you first</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}

/* Beat 1: the try-out, unchanged in substance: the live offer, its exact amount, and a hold that buys nothing. */

function TryOut({ listing, on, onFocus, narrow }: { listing: Listing | undefined; on: boolean; onFocus: () => void; narrow: boolean }) {
  const [round, setRound] = useState(0);
  if (!listing) {
    return (
      <div className={cx("story__try", on && "is-on")}>
        <p className="story__quiet">No offer is listed on this hub yet, so there is nothing to try the hold on.</p>
      </div>
    );
  }
  const { offer } = listing;
  const rail = offer.rails[0];
  // The payee on the rail this prices: payTo when the offer names one (a Hedera account), else the seller's key.
  const payee = (rail && offer.payTo?.[rail]) || offer.seller;
  return (
    <div className={cx("story__try", on && "is-on")} onFocus={onFocus}>
      <p className="story__offer">
        <span className="label">{listing.online ? "Live offer" : "Listed offer"}</span>
        <Link to={`/offer/${listing.hash}`}>{offer.title}</Link>
      </p>
      <p className="story__exact">
        <span className="label">You countersign exactly</span>
        <Amount money={usd(offer.price, rail)} size={narrow ? "lg" : "xl"} flight />
      </p>
      <dl className="story__lines story__lines--two">
        <div>
          <dt className="label">Payee</dt>
          <dd>
            <Hash value={payee} label="payee" copy={false} />
          </dd>
        </div>
        <div>
          <dt className="label">Offer hash</dt>
          <dd>
            <Hash value={listing.hash} head={10} tail={8} label="offer hash" copy={false} />
          </dd>
        </div>
      </dl>
      <HoldToSign
        key={round}
        ariaLabel={`Try the hold for ${offer.title}; nothing is bought`}
        left={listing.seller.name}
        right="you"
        onSigned={() => undefined}
      />
      <p className="story__quiet">
        A try-out: holding here buys nothing. An agent’s real purchase is signed with its own key.{" "}
        <button type="button" className="link-button" onClick={() => setRound((n) => n + 1)}>
          Clear it
        </button>
      </p>
    </div>
  );
}

/* Beat 2: the newest release from an escrow contract, with its amount, transaction and slip; the other rails said plainly. */

function Release({
  s,
  others,
  reading,
  on,
  onFocus,
  narrow,
}: {
  s: Settlement | undefined;
  others: string[];
  reading: boolean;
  on: boolean;
  onFocus: () => void;
  narrow: boolean;
}) {
  const template = s ? explorerTemplate(s.network) : undefined;
  const href = s ? (s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined)) : undefined;
  return (
    <div className={cx("story__release", on && "is-on")} onFocus={onFocus}>
      {s ? (
        <>
          <p className="story__exact">
            <span className="status status--released">Released</span>
            <Amount money={usd(s.amount, s.rail)} size={narrow ? "lg" : "xl"} />
          </p>
          <dl className="story__lines story__lines--two">
            <div className="story__wide">
              <dt className="label">Offer</dt>
              <dd>{s.title || "Untitled offer"}</dd>
            </div>
            <div className="story__wide">
              <dt className="label">Rail</dt>
              <dd>
                {RAIL_LABEL[s.rail] ?? s.rail} · {networkName(s.network)}
              </dd>
            </div>
            <div>
              <dt className="label">Transaction</dt>
              <dd>
                {href ? (
                  <Hash value={s.tx} href={href} tx head={8} tail={6} label="transaction" />
                ) : (
                  <Hash value={s.tx} head={8} tail={6} label="transaction" />
                )}
              </dd>
            </div>
            {s.slipHash ? (
              <div>
                <dt className="label">Slip</dt>
                <dd>
                  <Hash value={s.slipHash} head={8} tail={6} label="slip hash" />
                </dd>
              </div>
            ) : null}
          </dl>
          {s.slipHash ? (
            <Link to={`/verify/${s.slipHash}`} className="story__go">
              Check it without us
            </Link>
          ) : null}
        </>
      ) : (
        <p className="story__quiet" aria-busy={reading || undefined}>
          {reading ? READING : "No escrow release on this hub yet. The first one lands here, with its slip."}
        </p>
      )}
      {others.map((line) => (
        <p key={line} className="story__quiet">
          {line}
        </p>
      ))}
    </div>
  );
}
