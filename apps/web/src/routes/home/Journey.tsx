import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Slip } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatClock, shortHex, usd } from "../../lib/format.ts";
import type { EnvelopeView, Listing, RailDeclaration, Settlement } from "../../lib/types.ts";
import { verifySlip, type Verdict } from "../../lib/verify.ts";
import { Amount, cx, Hash } from "../../ui/primitives.tsx";
import { heldBy } from "./field.ts";
import {
  BEATS,
  dotAt,
  drawnAt,
  litAt,
  NARROW_LAYOUT,
  pointOn,
  NODE_ORDER,
  nodeAt,
  PATH_ORDER,
  ROLES,
  settledAt,
  STATEMENTS,
  WEIGHTS,
  WIDE_LAYOUT,
  type Layout,
  type NodeId,
  type PathId,
} from "./journey.ts";
import { span, toBeat, useStageFrame } from "./stage.ts";

/*
 * Beats 2 to 4 of the landing, on one pinned diagram: the parties arrive and their connections
 * draw, the agent's limits light the first line, and one real escrow payment rides the rest, from
 * your countersignature to the seller. Every figure on the cards is that payment's own record from
 * the hub; with no such payment, the cards say so, and the diagram explains without numbers.
 * Under reduced motion nothing pins: each beat is its own section with the diagram in its state.
 */

export const HUB_DOWN = "The hub did not answer, so there is no live payment to follow right now.";
export const NO_RELEASE = "No escrow payment has cleared on this hub yet. The first one shows here, step by step.";

export interface JourneyProps {
  /** The newest release from an escrow contract (escrowRelease): the only payment this follows. */
  release: Settlement | undefined;
  rails: RailDeclaration[] | undefined;
  envelope: EnvelopeView | undefined;
  /** Some read the landing needs has never come back from the hub. */
  hubDown: boolean;
  pinned: boolean;
  narrow: boolean;
}

export function JourneyStage(props: JourneyProps) {
  const { pinned, narrow } = props;
  const stage = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const layout = narrow ? NARROW_LAYOUT : WIDE_LAYOUT;
  const record = useRecord(props.release, props.hubDown);

  const paint = useCallback((beat: number, t: number) => {
    if (svg.current) paintDiagram(svg.current, beat, t);
  }, []);
  const beat = useStageFrame(stage, WEIGHTS, pinned, paint);
  const go = (b: number) => toBeat(stage.current, WEIGHTS, b);

  // A new layout (a phone turned) is new elements: paint them where the scroll already is.
  useEffect(() => {
    if (pinned && svg.current && stage.current) window.dispatchEvent(new Event("scroll"));
  }, [narrow, pinned]);

  if (!pinned) {
    return (
      <section ref={stage} className="journey journey--static" aria-label="How a purchase clears">
        {STATEMENTS.map((_, b) => (
          <div key={b} className="journey__frame" data-beat={b}>
            <div className="journey__grid">
              <Copy beat={b} only {...props} record={record} go={go} />
              <Diagram layout={layout} still={{ beat: b, t: 1 }} />
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section
      ref={stage}
      className="journey journey--pinned"
      style={{ "--span": span(WEIGHTS) } as CSSProperties}
      aria-label="How a purchase clears"
    >
      <div className="journey__frame" data-beat={beat}>
        <div className="journey__grid">
          <Copy beat={beat} only={false} {...props} record={record} go={go} />
          <Diagram layout={layout} svgRef={svg} />
        </div>
        <Progress beat={beat} go={go} />
      </div>
    </section>
  );
}

/* The diagram */

function Diagram({
  layout,
  svgRef,
  still,
}: {
  layout: Layout;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  /** Unpinned: the state to draw, inline, with no frame loop. */
  still?: { beat: number; t: number };
}) {
  const lit = still ? litAt(still.beat, still.t) : undefined;
  const drawn = still ? drawnAt(still.beat, still.t) : undefined;
  const dot = still ? dotAt(still.beat, still.t) : undefined;
  return (
    <div className="journey__stage" aria-hidden="true">
      <svg
        ref={svgRef}
        className="diagram"
        data-settled={still && settledAt(still.beat, still.t) ? "" : undefined}
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="diagram__rules">
          {PATH_ORDER.map((id) => (
            <path
              key={id}
              data-rule={id}
              d={layout.paths[id]}
              pathLength={1}
              style={drawn !== undefined ? { strokeDashoffset: 1 - drawn } : undefined}
            />
          ))}
        </g>
        <g className="diagram__lit">
          {PATH_ORDER.map((id) => (
            <path
              key={id}
              data-lit={id}
              className={id === "es" ? "is-release" : undefined}
              d={layout.paths[id]}
              pathLength={1}
              style={lit ? { strokeDashoffset: 1 - lit[id] } : undefined}
            />
          ))}
        </g>
        {NODE_ORDER.map((id, i) => {
          const n = layout.nodes[id];
          return (
            <g
              key={id}
              data-node={id}
              className={cx("diagram__node", `diagram__node--${id}`)}
              transform={`translate(${n.x} ${n.y})`}
              style={still ? { opacity: nodeAt(still.beat, still.t, i) } : undefined}
            >
              <circle className="diagram__halo" r={34} />
              <circle className="diagram__disc" r={26} />
              <NodeGlyph id={id} />
              <text className="diagram__name" y={52} textAnchor="middle">
                {ROLES[id].name}
              </text>
            </g>
          );
        })}
        <g className="diagram__dot" data-dot-el="" style={dot ? { transform: dotTransform(layout, dot.path, dot.t) } : { opacity: 0 }}>
          <circle className="diagram__dot-ring" r={13} />
          <circle className="diagram__dot-core" r={6} />
        </g>
      </svg>
    </div>
  );
}

/** For the unpinned diagram, where no element can be measured: the point by sampling the path's own geometry. */
function dotTransform(layout: Layout, path: PathId, t: number): string {
  const p = pointOn(layout.paths[path], t);
  return `translate(${p.x}px, ${p.y}px)`;
}

/** Pinned: the frame loop writes the drawing straight onto its elements. */
function paintDiagram(svg: SVGSVGElement, beat: number, t: number): void {
  const drawn = drawnAt(beat, t);
  const lit = litAt(beat, t);
  svg.querySelectorAll<SVGPathElement>("[data-rule]").forEach((p) => {
    p.style.strokeDashoffset = String(1 - drawn);
  });
  svg.querySelectorAll<SVGPathElement>("[data-lit]").forEach((p) => {
    p.style.strokeDashoffset = String(1 - lit[p.dataset.lit as PathId]);
  });
  svg.querySelectorAll<SVGGElement>("[data-node]").forEach((g, i) => {
    g.style.opacity = String(nodeAt(beat, t, i));
  });
  const dotEl = svg.querySelector<SVGGElement>("[data-dot-el]");
  const dot = dotAt(beat, t);
  if (!dotEl) return;
  svg.toggleAttribute("data-settled", settledAt(beat, t));
  if (!dot) {
    dotEl.style.opacity = "0";
    return;
  }
  const path = svg.querySelector<SVGPathElement>(`[data-rule="${dot.path}"]`);
  if (!path) return;
  const p = path.getPointAtLength(path.getTotalLength() * dot.t);
  dotEl.style.opacity = "1";
  dotEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
}

function NodeGlyph({ id }: { id: NodeId }) {
  // 20 px line icons, centred on the node.
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <g className="diagram__glyph" transform="translate(-10 -10)">
      {id === "agent" ? (
        <g {...common}>
          <rect x="3" y="6" width="14" height="10" rx="3" />
          <path d="M10 6V3M7.5 11h.01M12.5 11h.01" />
        </g>
      ) : id === "you" ? (
        <g {...common}>
          <circle cx="10" cy="7" r="3.2" />
          <path d="M3.5 17c1.2-3.2 3.7-4.6 6.5-4.6s5.3 1.4 6.5 4.6" />
        </g>
      ) : id === "hub" ? (
        <g {...common}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3" />
        </g>
      ) : id === "escrow" ? (
        <g {...common}>
          <rect x="4" y="9" width="12" height="8" rx="2" />
          <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
        </g>
      ) : (
        <g {...common}>
          <path d="M4 8.5 10 4l6 4.5V16H4Z" />
          <path d="M8 16v-4h4v4" />
        </g>
      )}
    </g>
  );
}

/* The words and the evidence beside the diagram */

interface CopyProps extends JourneyProps {
  beat: number;
  only: boolean;
  record: RecordView;
  go: (b: number) => void;
}

function Copy({ beat, only, release, rails, envelope, hubDown, narrow, record, go }: CopyProps) {
  const at = Math.min(beat, BEATS.released);
  const on = (b: number) => at === b;
  const shows = (b: number) => !only || at === b;
  const bring = (b: number) => () => {
    if (!only && !on(b)) go(b);
  };
  const live = release !== undefined && !hubDown;
  const own = release ? heldBy(release, rails, record.slip) : undefined;

  return (
    <div className="journey__copy">
      <p className="journey__step num" aria-hidden={only ? undefined : true}>
        {`0${at + 1}`}
        <span> / 05</span>
      </p>
      <div className="journey__lines">
        {STATEMENTS.map((words, b) =>
          shows(b) ? (
            <h2 key={b} className={cx("journey__line", on(b) && "is-on")}>
              {words}
            </h2>
          ) : null,
        )}
      </div>

      <div className="journey__cards">
        {shows(BEATS.cast) ? (
          <Card on={on(BEATS.cast)} onFocus={bring(BEATS.cast)}>
            <dl className="journey__roles">
              {(["agent", "you", "hub", "escrow", "seller"] as const).map((id) => (
                <div key={id}>
                  <dt>{ROLES[id].name}</dt>
                  <dd>{ROLES[id].does}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}

        {shows(BEATS.limits) ? (
          <Card on={on(BEATS.limits)} onFocus={bring(BEATS.limits)}>
            <EnvelopeLines view={envelope} />
          </Card>
        ) : null}

        {shows(BEATS.countersign) ? (
          <Card on={on(BEATS.countersign)} onFocus={bring(BEATS.countersign)}>
            {live && release ? (
              <dl className="journey__data">
                <Row label="Offer">{(record.listing?.offer.title ?? release.title) || "Untitled offer"}</Row>
                <Row label="Amount">
                  <Amount money={usd(release.amount, release.rail)} size={narrow ? "md" : "lg"} flight />
                </Row>
                {(release.buyer ?? record.slip?.body.buyer) ? (
                  <Row label="Buyer">
                    <Hash value={(release.buyer ?? record.slip?.body.buyer)!} label="buyer" copy={false} />
                  </Row>
                ) : null}
                <Row label="Seller">{record.listing?.seller.name ?? shortHex(release.seller)}</Row>
              </dl>
            ) : (
              <Honest hubDown={hubDown} />
            )}
          </Card>
        ) : null}

        {shows(BEATS.held) ? (
          <Card on={on(BEATS.held)} onFocus={bring(BEATS.held)}>
            {live && release && own ? (
              <>
                <dl className="journey__data">
                  {own.escrow ? (
                    <Row label="Escrow">
                      <Hash value={own.escrow} href={own.escrowHref} label="escrow address" copy={false} />
                    </Row>
                  ) : null}
                  <Row label="Chain">{own.chain}</Row>
                  <Row label="Job">
                    <Hash value={release.jobId} label="job" copy={false} />
                  </Row>
                </dl>
                <p className="journey__quiet">{`Held on ${own.chain} by the escrow contract until the output checks out.`}</p>
              </>
            ) : (
              <Honest hubDown={hubDown} />
            )}
          </Card>
        ) : null}

        {shows(BEATS.released) ? (
          <Card on={on(BEATS.released)} onFocus={bring(BEATS.released)}>
            {live && release && own ? (
              <>
                <dl className="journey__data">
                  {release.slipHash ? (
                    <Row label="Slip">
                      <Hash value={release.slipHash} label="slip hash" copy={false} />
                    </Row>
                  ) : null}
                  <Row label="Release">
                    <Hash value={release.tx} href={own.txHref} tx label="release transaction" />
                  </Row>
                  <Row label="Check">{checkWord(record.verdict)}</Row>
                </dl>
                {release.slipHash ? (
                  <Link to={`/verify/${release.slipHash}`} className="journey__go">
                    Check it without us →
                  </Link>
                ) : null}
              </>
            ) : (
              <Honest hubDown={hubDown} />
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Card({ on, onFocus, children }: { on: boolean; onFocus: () => void; children: ReactNode }) {
  return (
    <div className={cx("journey__card", on && "is-on")} onFocus={onFocus} aria-hidden={on ? undefined : true} inert={!on || undefined}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="journey__row">
      <dt className="label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Honest({ hubDown }: { hubDown: boolean }) {
  return <p className="journey__quiet journey__honest">{hubDown ? HUB_DOWN : NO_RELEASE}</p>;
}

/*
 * The envelope as plain lines. Until the hub serves an agent's own, the example: its four fields in
 * words, with no amount, agent or time, so it never reads as a record.
 */
function EnvelopeLines({ view }: { view: EnvelopeView | undefined }) {
  if (!view) {
    return (
      <>
        <p className="label">Example envelope</p>
        <dl className="journey__data">
          <Row label="Budget">The most it spends in all</Row>
          <Row label="Cap per seller">The most any one seller gets</Row>
          <Row label="Allowlist">Only the sellers you name</Row>
          <Row label="Ask above">Above this price, it asks you first</Row>
        </dl>
      </>
    );
  }
  const n = view.envelope.allowlist.length;
  return (
    <>
      <p className="label">
        Signed envelope
        {view.mirror ? <span className="journey__meta">{` · ${view.agentName} · ${formatClock(view.mirror.signedAt)}`}</span> : null}
      </p>
      <dl className="journey__data">
        <Row label="Budget">
          <Amount money={usd(view.envelope.cap)} size="sm" /> <span className="journey__quiet">· spent</span>{" "}
          <Amount money={usd(view.spent.total)} size="sm" />
        </Row>
        <Row label="Cap per seller">
          <Amount money={usd(view.envelope.perMerchant)} size="sm" />
        </Row>
        <Row label="Allowlist">{n === 0 ? "Any seller" : `${n} ${n === 1 ? "seller" : "sellers"}`}</Row>
        <Row label="Ask above">{view.askAbove === null ? "Never" : <Amount money={usd(view.askAbove)} size="sm" />}</Row>
      </dl>
    </>
  );
}

/** The beats as a row of ticks: where you are, and a way to jump. */
function Progress({ beat, go }: { beat: number; go: (b: number) => void }) {
  const at = Math.min(beat, BEATS.released);
  return (
    <ol className="journey__ticks" aria-label="Steps">
      {STATEMENTS.map((words, b) => (
        <li key={b}>
          <button type="button" className={cx("journey__tick", b === at && "is-on", b < at && "is-done")} onClick={() => go(b)} aria-current={b === at ? "step" : undefined}>
            <span className="sr-only">{`Step ${b + 1}: ${words}`}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* The payment's own record: its listing and slip from the hub, and the verifier's verdict. */

interface RecordView {
  listing: Listing | undefined;
  slip: Slip | undefined;
  verdict: Verdict | null;
}

function useRecord(release: Settlement | undefined, hubDown: boolean): RecordView {
  // The hub's own records only: a read that came from fixtures is treated as no read at all.
  const listingRead = useResource(
    () => (release && !hubDown ? api.listing(release.offerHash) : Promise.resolve({ data: undefined, source: "absent" as const })),
    [release?.offerHash, hubDown],
  );
  const listing = !listingRead.loading && listingRead.source === "hub" ? listingRead.data : undefined;
  const slipRead = useResource(
    () =>
      release && !hubDown && release.slipHash ? api.slip(release.slipHash) : Promise.resolve({ data: undefined, source: "absent" as const }),
    [release?.slipHash, hubDown],
  );
  const slip = !slipRead.loading && slipRead.source === "hub" ? slipRead.data?.slip : undefined;
  // The same verifier the verify page runs, from the slip's own bytes.
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
  return { listing, slip, verdict };
}

function checkWord(verdict: Verdict | null): ReactNode {
  if (!verdict) return <span className="journey__quiet">Checking…</span>;
  if (verdict.valid) return <span className="status status--released">Verified in this browser</span>;
  const failed = verdict.checks.find((c) => c.state === "fail");
  return <span className="journey__quiet">Not verified: {failed?.detail ?? "the slip did not check."}</span>;
}
