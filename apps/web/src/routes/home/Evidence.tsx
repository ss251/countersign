import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, navigate } from "../../app/router.tsx";
import { explorerTemplate, formatAgo, formatAmount, formatClock, networkName, RAIL_LABEL, usd } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import type { HubStats, Listing, RailDeclaration, RailId, Settlement } from "../../lib/types.ts";
import { Amount, cx, Hash } from "../../ui/primitives.tsx";
import { exampleNeeds } from "../assistant/palette.ts";
import {
  asideAt,
  byTime,
  EXIT,
  isRetired,
  keyOf,
  labelSpots,
  markSpots,
  NARROW,
  newestOf,
  railOrder,
  railsLine,
  retiredLabel,
  ROOMY,
  WIDE,
  type Spot,
} from "./field.ts";
import { span, toBeat, useBeat } from "./stage.ts";

/*
 * The first stage: the claim, then its evidence, in one pinned frame.
 *   0 the claim, as it was: the statement, what countersign is, the live line, the way in.
 *   1 "Every payment here was real.": one mark per settlement on a tape of time; the totals in a corner.
 *   2 "On three live rails.": the same marks regroup by rail, each group named with its chain and count.
 *   3 "Each one left a slip anyone can check.": the newest mark lifts out into its receipt.
 *   4 "Ask for one.": the ask box slides in beside the receipt.
 *   5 the exit: all of the stage's evidence leaves together and only the last statement rides the
 *     frame away, so nothing is orphaned under the next stage.
 */

/**
 * Screens of scroll per beat. The exit is 0.3 of a screen: with the stretch before the statement
 * slides under the bar, it holds alone for about half a screen, and the 240 ms fade still finishes
 * before the frame moves. Unpinned, the exit is not a section of its own.
 */
const WEIGHTS = [1, 1, 1, 1, 1, 0.3] as const;
const SECTIONS = EXIT;

export interface EvidenceProps {
  /** The last good read of the hub's totals. */
  stats: HubStats | null;
  /** Why there are no totals at all, when the hub has never answered with them. */
  missing: string | undefined;
  /** Settlements read from the hub, never from fixtures. */
  rows: Settlement[];
  /** The hub has answered the settlements read at least once. */
  loaded: boolean;
  rails: RailDeclaration[] | undefined;
  listings: Listing[];
  pinned: boolean;
  narrow: boolean;
}

export function EvidenceStage(props: EvidenceProps) {
  const stage = useRef<HTMLElement>(null);
  const beat = useBeat(stage, WEIGHTS, props.pinned);
  const go = (b: number) => toBeat(stage.current, WEIGHTS, b);
  if (!props.pinned) {
    return (
      <section ref={stage} className="story story--static story--evidence" aria-label="The claim and its evidence">
        {Array.from({ length: SECTIONS }, (_, b) => (
          <EvidenceFrame key={b} {...props} beat={b} only go={go} />
        ))}
      </section>
    );
  }
  return (
    <section
      ref={stage}
      className="story story--pinned story--evidence"
      style={{ "--span": span(WEIGHTS) } as CSSProperties}
      aria-label="The claim and its evidence"
    >
      <EvidenceFrame {...props} beat={beat} only={false} go={go} />
    </section>
  );
}

function EvidenceFrame({
  beat,
  only,
  go,
  stats,
  missing,
  rows,
  loaded,
  rails,
  listings,
  narrow,
}: EvidenceProps & { beat: number; only: boolean; go: (beat: number) => void }) {
  const order = railOrder(rails, rows);
  const none = loaded && rows.length === 0;
  // Pinned, every layer stays mounted and the beat sets its state; unpinned, a section holds only its own beat.
  const shows = (from: number, to = from) => !only || (beat >= from && beat <= to);
  const on = (from: number, to = from) => beat >= from && beat <= to;
  // Keyboard focus that lands in a layer brings its beat into view, so nothing focusable is ever unseen.
  const bring = (from: number, to = from) => () => {
    if (!only && !on(from, to)) go(from);
  };
  const totalsTo = narrow ? 2 : 4;
  return (
    <div className="story__frame" data-beat={beat}>
      {shows(0) ? <Claim on={on(0)} onFocus={bring(0)} stats={stats} rails={rails} missing={missing} down={() => go(1)} /> : null}
      <div className="story__box">
        {shows(1) ? <h2 className={cx("story__line", on(1) && "is-on")}>{none ? "No payment has moved on this hub yet." : "Every payment here was real."}</h2> : null}
        {shows(2) ? <h2 className={cx("story__line", on(2) && "is-on")}>{railsLine(rails, order)}</h2> : null}
        {shows(3) ? <h2 className={cx("story__line", on(3) && "is-on")}>Each one left a slip anyone can check.</h2> : null}
        {shows(4) ? <h2 className={cx("story__line", on(4, EXIT) && "is-on")}>Ask for one.</h2> : null}
        {shows(1, 4) ? (
          <div className="story__plane">
            <Field rows={rows} order={order} rails={rails} stats={stats} beat={beat} narrow={narrow} />
            {shows(3, 4) ? (
              <div className="story__aside" style={asideStyle(beat, narrow)}>
                <Receipt s={newestOf(rows)} on={on(3, 4)} onFocus={bring(3, 4)} narrow={narrow} />
                {shows(4) ? <Ask listings={listings} on={on(4)} onFocus={bring(4)} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {shows(1, totalsTo) ? <Totals stats={stats} missing={missing} on={on(1, totalsTo)} /> : null}
        {!only || beat === 2 ? <Ledger rows={rows} order={order} rails={rails} stats={stats} /> : null}
      </div>
    </div>
  );
}

/* Beat 0: the claim, unchanged from round 2, on the plain field: the story ships with CSS only. */

function Claim({
  on,
  onFocus,
  stats,
  rails,
  missing,
  down,
}: {
  on: boolean;
  onFocus: () => void;
  stats: HubStats | null;
  rails: RailDeclaration[] | undefined;
  missing: string | undefined;
  down: () => void;
}) {
  return (
    <div className={cx("story__claim", on && "is-on")} onFocus={onFocus}>
      <div className="landing__first-inner">
        <h1 id="statement" className="landing__statement">
          payments that only move when the work lands.
        </h1>
        <div className="landing__under">
          <p className="landing__what">
            countersign lets an agent pay for a tool only inside limits you sign. On an escrow rail the payment waits until the
            output checks out; every settled payment leaves a slip anyone can verify, without us.
          </p>
          <Figures stats={stats} rails={rails} missing={missing} down={down} />
          <div className="landing__cta">
            <Link to="/assistant" className="landing__go">
              Ask for a paid tool
            </Link>
            <button type="button" className="landing__cue" onClick={down}>
              ↓ live desk
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The first screen's number: the hub's own totals in one mono line, and the way down to the
 * evidence. It holds its line before the first read, ticks once on change, and is left out when
 * the hub has never given totals.
 */
export function Figures({
  stats: s,
  rails,
  missing,
  down,
}: {
  stats: HubStats | null;
  rails: RailDeclaration[] | undefined;
  missing: string | undefined;
  down: () => void;
}) {
  if (missing) return null;
  if (!s) return <p className="landing__figures" aria-hidden="true" />;
  const live = rails?.length ?? 0;
  return (
    <button type="button" className="landing__figures" onClick={down}>
      <span className="live-dot" aria-hidden="true" />
      <span className="landing__fig">
        <Tick value={String(s.delivered)} /> {s.delivered === 1 ? "job" : "jobs"} settled
      </span>
      <span className="landing__fig">
        <Sep />
        <Tick value={formatAmount(usd(s.volume))} /> USDC
      </span>
      {live ? (
        <span className="landing__fig">
          <Sep />
          <Tick value={String(live)} /> {live === 1 ? "rail" : "rails"} live
        </span>
      ) : null}
      <span className="sr-only">. Go to the evidence.</span>
    </button>
  );
}

/** A middle dot to the eye, a pause to a screen reader. */
function Sep() {
  return (
    <span className="landing__sep">
      <span aria-hidden="true">·</span>
      <span className="sr-only">,</span>
    </span>
  );
}

/* Beats 1 to 4: the field. Every mark is one settlement; the marks are drawn, the ledger below says them. */

function Field({
  rows,
  order,
  rails,
  stats,
  beat,
  narrow,
}: {
  rows: Settlement[];
  order: RailId[];
  rails: RailDeclaration[] | undefined;
  stats: HubStats | null;
  beat: number;
  narrow: boolean;
}) {
  const g = narrow ? NARROW : WIDE;
  const spots = markSpots(rows, order, beat, narrow);
  const labels = labelSpots(order, beat, narrow);
  const sorted = byTime(rows);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const line = beat === 1 || beat === 2 ? 1 : beat === 3 ? (narrow ? 0.22 : 0.3) : 0;
  const crowded = order.length > ROOMY;
  return (
    <div className="story__field" aria-hidden="true" style={{ "--base": g.base } as CSSProperties}>
      <span className="story__baseline" style={{ opacity: line }} />
      {first && last ? (
        <>
          <span className="story__end" style={{ opacity: beat === 1 ? 1 : 0 }}>
            {formatClock(first.at)}
          </span>
          <span className="story__end story__end--last" style={{ opacity: beat === 1 ? 1 : 0 }}>
            {formatClock(last.at)}
          </span>
        </>
      ) : null}
      {sorted.map((s, i) => {
        // The newest lifts out on its own; the rest arrive and regroup in time order, a beat apart.
        const lifted = s === last && beat >= 3;
        return <span key={keyOf(s)} className="story__mark" style={markStyle(spots.get(keyOf(s)), g.mark, lifted ? 0 : i)} />;
      })}
      {order.map((rail, i) => {
        const decl = rails?.find((r) => r.id === rail);
        const count = stats?.byRail[rail]?.delivered ?? rows.filter((s) => s.rail === rail).length;
        const p = labels[i];
        const label = RAIL_LABEL[rail] ?? rail;
        const name = isRetired(rail, rails) ? retiredLabel(label) : label;
        // Crowded, a label is the chain over the rail, short enough for a fifth of a phone's width.
        const [chain, kind] = name.includes(" · ") ? name.split(" · ", 2) : [name, ""];
        return (
          <span
            key={rail}
            className={cx("story__group", crowded && "is-crowded")}
            style={p ? ({ "--x": p.x, "--dy": p.dy, "--o": p.o } as CSSProperties) : undefined}
          >
            {crowded ? (
              <>
                <span className="story__group-name">{chain}</span>
                {kind ? <span className="story__group-chain">{kind}</span> : null}
              </>
            ) : (
              <>
                <span className="story__group-name">
                  <span className="live-dot" />
                  {name}
                </span>
                {decl ? <span className="story__group-chain">{networkName(decl.network)}</span> : null}
              </>
            )}
            <span className="story__group-n mono">{count} settled</span>
          </span>
        );
      })}
    </div>
  );
}

function markStyle(p: Spot | undefined, size: number, order: number): CSSProperties {
  const q = p ?? { x: 50, y: 50, dx: 0, dy: 0, s: 0.6, o: 0 };
  return {
    "--x": q.x,
    "--y": q.y,
    "--dx": q.dx,
    "--dy": q.dy,
    "--s": q.s,
    "--o": q.o,
    "--m": `${size}px`,
    "--d": `${Math.min(order, 24) * 14}ms`,
  } as CSSProperties;
}

function asideStyle(beat: number, narrow: boolean): CSSProperties {
  const a = asideAt(beat, narrow, narrow ? NARROW : WIDE);
  return { "--y": a.y, "--dy": a.dy } as CSSProperties;
}

/** For a screen reader: the rails and every settlement, said once, oldest first. */
function Ledger({
  rows,
  order,
  rails,
  stats,
}: {
  rows: Settlement[];
  order: RailId[];
  rails: RailDeclaration[] | undefined;
  stats: HubStats | null;
}) {
  const now = useNow(60_000);
  return (
    <div className="sr-only">
      <p>The rails this hub runs:</p>
      <ul>
        {order.map((rail) => {
          const decl = rails?.find((r) => r.id === rail);
          const count = stats?.byRail[rail]?.delivered ?? rows.filter((s) => s.rail === rail).length;
          return (
            <li key={rail}>
              {isRetired(rail, rails) ? retiredLabel(RAIL_LABEL[rail] ?? rail) : (RAIL_LABEL[rail] ?? rail)}
              {decl ? ` on ${networkName(decl.network)}` : ""}, {count} settled
            </li>
          );
        })}
      </ul>
      <p>Every settlement on this hub, oldest first:</p>
      <ol>
        {byTime(rows).map((s) => (
          <li key={keyOf(s)}>
            {s.title || "Untitled offer"}: {formatAmount(usd(s.amount, s.rail))} USDC on {RAIL_LABEL[s.rail] ?? s.rail},{" "}
            {formatAgo(s.at, now)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* The totals, label over value, from the hub's own ledger; a failed poll keeps the last good read. */

function Totals({ stats: s, missing, on }: { stats: HubStats | null; missing: string | undefined; on: boolean }) {
  return (
    <div className={cx("story__totals", on && "is-on")}>
      {missing ? (
        <p className="story__quiet">{missing}</p>
      ) : (
        <>
          <dl className="story__sums" aria-busy={!s}>
            <div>
              <dt className="label">Offers listed</dt>
              <dd>{s ? <Tick value={String(s.offers.listed)} /> : <span className="story__wait" />}</dd>
            </div>
            <div>
              <dt className="label">Jobs settled</dt>
              <dd>{s ? <Tick value={String(s.delivered)} /> : <span className="story__wait" />}</dd>
            </div>
            <div>
              <dt className="label">USDC settled</dt>
              <dd>{s ? <Tick value={formatAmount(usd(s.volume))} /> : <span className="story__wait" />}</dd>
            </div>
          </dl>
          {s ? (
            <p className="story__updated">
              <span className="live-dot" aria-hidden="true" />
              live · updated <span className="mono">{formatClock(s.asOf)}</span>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/* Beat 3: the newest settlement as one receipt, unboxed: plain lines under a hairline. */

function Receipt({ s, on, onFocus, narrow }: { s: Settlement | undefined; on: boolean; onFocus: () => void; narrow: boolean }) {
  const now = useNow(10_000);
  if (!s) {
    return (
      <div className={cx("story__receipt", on && "is-on")}>
        <p className="story__quiet">The first payment on this hub lands here, with its slip.</p>
      </div>
    );
  }
  const template = explorerTemplate(s.network);
  const href = s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined);
  return (
    <div className={cx("story__receipt", on && "is-on")} onFocus={onFocus}>
      <p className="story__receipt-title">{s.title || "Untitled offer"}</p>
      <Amount money={usd(s.amount, s.rail)} size={narrow ? "lg" : "xl"} />
      <dl className="story__lines story__lines--two">
        <div>
          <dt className="label">Seller</dt>
          <dd>
            <Hash value={s.seller} label="seller address" copy={false} />
          </dd>
        </div>
        <div>
          <dt className="label">Paid</dt>
          <dd className="mono">{formatAgo(s.at, now)}</dd>
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
    </div>
  );
}

/* Beat 4: a need in plain words, straight into the assistant, with three that find a live offer. */

function Ask({ listings, on, onFocus }: { listings: Listing[]; on: boolean; onFocus: () => void }) {
  const [need, setNeed] = useState("");
  const id = useId();
  const examples = exampleNeeds(listings);
  const ask = (q: string) => navigate(`/assistant?q=${encodeURIComponent(q.trim())}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (need.trim()) ask(need);
  };
  return (
    <div className={cx("story__ask", on && "is-on")} onFocus={onFocus}>
      <form className="askbox" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor={id}>
          What does your agent need?
        </label>
        <input
          id={id}
          className="askbox__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="What does your agent need?"
          value={need}
          onChange={(e) => setNeed(e.target.value)}
        />
        <button type="submit" className="askbox__go">
          Ask
        </button>
      </form>
      {examples.length ? (
        <ul className="story__needs" aria-label="Needs that find a live offer">
          {examples.map((x) => (
            <li key={x.need}>
              <button type="button" className="story__need" onClick={() => ask(x.need)}>
                <span className="mono">{x.need}</span>
                <span className="story__quiet">finds {x.hits.offer.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A total that ticks once when it changes, and never counts up from zero on load. */
export function Tick({ value }: { value: string }) {
  const [turn, setTurn] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setTurn((n) => n + 1);
  }, [value]);
  return (
    <span key={turn} className={cx("tick", turn > 0 && "is-ticked")}>
      {value}
    </span>
  );
}

