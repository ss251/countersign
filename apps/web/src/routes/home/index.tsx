import { useEffect, useRef } from "react";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { shortHex } from "../../lib/format.ts";
import type { HubStats, RailDeclaration, Settlement } from "../../lib/types.ts";
import { escrowRelease } from "./field.ts";
import { Hero } from "./Hero.tsx";
import { JourneyStage } from "./Journey.tsx";
import { useNarrow, useReducedMotion } from "./stage.ts";
import { Stream } from "./Stream.tsx";
import { SettlesOn } from "./SettlesOn.tsx";
import "./landing.css";

/** The landing draws full bleed under the shared bar. */
export const surface = "story";

const REPO = "https://github.com/ss251/countersign";
const POLL_MS = 10_000;

/**
 * The front door, told as one story with its evidence:
 *   1 the hero: the claim over a swelling glyph field, with the hub's own figures;
 *   2–4 the journey: five parties on one diagram, and one real escrow payment riding it;
 *   5 the evidence: the hub's last settlements, live;
 *   6 the proof: where to check all of it without us.
 * Every number is the hub's own, read while you look; under reduced motion nothing pins.
 */
export default function Landing(_props: PageProps) {
  const stats = useResource(() => api.stats(), []);
  const settlements = useResource(() => api.settlements(100), []);
  const rails = useResource(() => api.rails(), []);
  const envelope = useResource(() => api.envelope(), []);
  usePoll(stats.reload, POLL_MS);
  usePoll(settlements.reload, POLL_MS);
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const journey = useRef<HTMLDivElement>(null);

  // A poll that fails keeps the last good read on screen.
  const goodStats = useRef<HubStats | null>(null);
  if (stats.source === "hub" && stats.data) goodStats.current = stats.data;
  // Only the hub's own settlements, never a fixture.
  const goodRows = useRef<Settlement[] | null>(null);
  if (settlements.source === "hub" && settlements.data) goodRows.current = settlements.data;

  const missing = goodStats.current ? undefined : stats.source === "absent" ? stats.reason : undefined;
  const hubDown = missing !== undefined;
  const rows = goodRows.current ?? [];
  const hubRails = rails.source === "hub" ? rails.data : undefined;
  // The journey follows one payment, and only one an escrow contract held (audit A4).
  const release = escrowRelease(rows, hubRails);

  const down = () => {
    const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
    journey.current?.scrollIntoView({ behavior, block: "start" });
  };

  return (
    <div className="landing">
      <Hero stats={goodStats.current} missing={missing} railsLive={hubRails?.length} reduced={reduced} onDown={down} />

      <div ref={journey}>
        <JourneyStage
          release={release}
          rails={hubRails}
          envelope={envelope.source === "hub" && envelope.data ? envelope.data : undefined}
          hubDown={hubDown}
          pinned={!reduced}
          narrow={narrow}
        />
      </div>

      <SettlesOn rails={hubDown ? undefined : hubRails} />

      <Stream rows={rows} loaded={settlements.source !== undefined} rails={hubRails} hubDown={hubDown} />

      <Proof rails={hubRails} />
    </div>
  );
}

/* Check it without us: the links, then the way in and the repository. */

function Proof({ rails }: { rails: RailDeclaration[] | undefined }) {
  const escrow = rails?.find((r) => r.id === "escrow");
  const escrowHref =
    escrow?.escrow && escrow.explorerTx ? escrow.explorerTx.replace(/\/tx\/\{tx\}$/, `/address/${escrow.escrow}`) : undefined;
  return (
    <section className="proof" aria-labelledby="proof-title">
      <div className="proof__head">
        <p className="section-kicker">Proof</p>
        <h2 id="proof-title" className="proof__title">
          Check it without us.
        </h2>
      </div>
      <ul className="proof__list">
        <li>
          <a href={`${REPO}/blob/main/docs/proof.md`} target="_blank" rel="noreferrer">
            docs/proof.md <span aria-hidden="true">↗</span>
          </a>
          <span>Every claim, with its explorer link.</span>
        </li>
        {escrowHref && escrow?.escrow ? (
          <li>
            <a href={escrowHref} target="_blank" rel="noreferrer">
              The escrow on Arc <span aria-hidden="true">↗</span>
            </a>
            <span className="mono">{shortHex(escrow.escrow, 6, 4)}</span>
          </li>
        ) : null}
        <li>
          <a href="https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078" target="_blank" rel="noreferrer">
            A Hedera payment on HashScan <span aria-hidden="true">↗</span>
          </a>
          <span>Settled on Hedera testnet, with its slip.</span>
        </li>
        <li>
          <Link to="/verify">Verify a slip</Link>
          <span>From its own bytes and a public RPC.</span>
        </li>
        <li>
          <a href={REPO} target="_blank" rel="noreferrer">
            The repository <span aria-hidden="true">↗</span>
          </a>
          <span>The code, the spec and the end-to-end runs.</span>
        </li>
      </ul>
      <div className="proof__close">
        <Link to="/assistant" className="btn btn--primary">
          Ask for a paid tool
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer" className="proof__repo">
          github.com/ss251/countersign ↗
        </a>
      </div>
      <p className="proof__fine">Testnets only. Every figure on this page is read from the hub while you look at it.</p>
    </section>
  );
}

/** Read again every interval while the tab is visible; a hidden tab costs the hub nothing. */
function usePoll(reload: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, ms);
    return () => window.clearInterval(id);
  }, [reload, ms]);
}
