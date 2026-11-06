import { useEffect, useRef, useState } from "react";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { SiteLinks } from "../../app/SiteLinks.tsx";
import { api, useResource } from "../../lib/api.ts";
import { shortHex } from "../../lib/format.ts";
import type { HubStats, RailDeclaration, Settlement } from "../../lib/types.ts";
import { Wordmark } from "../../ui/Mark.tsx";
import { ClearsStage } from "./Clears.tsx";
import { EvidenceStage } from "./Evidence.tsx";
import { newestRelease } from "./field.ts";
import { useNarrow, useReducedMotion } from "./stage.ts";
import "./home.css";
import "./landing.css";

/** The landing draws its own chrome: a wordmark and a few links, nothing else. */
export const surface = "bare";

const REPO = "https://github.com/ss251/countersign";
const POLL_MS = 10_000;

/** The landing's own chrome: the wordmark, the views, and on a phone one sheet under the bar. */
function LandingBar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="landing__bar">
        <Link to="/" className="landing__brand" aria-label="countersign, home">
          <Wordmark size={22} />
        </Link>
        <nav className="landing__links" aria-label="Views">
          <SiteLinks className="landing__link" />
        </nav>
        <button
          type="button"
          className="landing__menu"
          aria-expanded={open}
          aria-controls="landing-views"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Views"}
        </button>
      </header>
      {open ? (
        <nav id="landing-views" className="landing__sheet" aria-label="Views">
          <SiteLinks className="landing__link" onNavigate={() => setOpen(false)} />
        </nav>
      ) : null}
    </>
  );
}

/**
 * The front door, told as a story with its evidence (DESIGN-NOTE "The landing, v2"). Two pinned
 * stages on native scroll, one statement per frame, and evidence that stays and changes state:
 * the claim and the hub's real payments, then how one clears, then where to check it all without
 * us. Every number is the hub's own, read while you look; under reduced motion nothing pins and
 * every beat is its own section.
 */
export default function Landing(_props: PageProps) {
  const stats = useResource(() => api.stats(), []);
  const settlements = useResource(() => api.settlements(100), []);
  const rails = useResource(() => api.rails(), []);
  const listings = useResource(() => api.listings(), []);
  const envelope = useResource(() => api.envelope(), []);
  usePoll(stats.reload, POLL_MS);
  usePoll(settlements.reload, POLL_MS);
  useDarkStatusBar();
  const pinned = !useReducedMotion();
  const narrow = useNarrow();

  // A poll that fails keeps the last good read on screen; its "updated" time says how old it is.
  const goodStats = useRef<HubStats | null>(null);
  if (stats.source === "hub" && stats.data) goodStats.current = stats.data;
  // The field draws only the hub's own settlements, never a fixture.
  const goodRows = useRef<Settlement[] | null>(null);
  if (settlements.source === "hub" && settlements.data) goodRows.current = settlements.data;

  const missing = goodStats.current ? undefined : stats.source === "absent" ? stats.reason : undefined;
  const rows = goodRows.current ?? [];
  const hubRails = rails.source === "hub" ? rails.data : undefined;
  const listed = (listings.data ?? []).filter((l) => l.status === "listed");
  const featured = listed.find((l) => l.online) ?? listed[0];

  return (
    <div className="landing">
      <LandingBar />

      <EvidenceStage
        stats={goodStats.current}
        missing={missing}
        rows={rows}
        loaded={settlements.source !== undefined}
        rails={hubRails}
        listings={listings.data ?? []}
        pinned={pinned}
        narrow={narrow}
      />

      <ClearsStage
        envelope={envelope.source === "hub" && envelope.data ? envelope.data : undefined}
        featured={featured}
        release={newestRelease(rows)}
        pinned={pinned}
        narrow={narrow}
      />

      <Proof rails={hubRails} />
    </div>
  );
}

/* Check it without us: five lines, then the way in, the repository and the footer line. */

function Proof({ rails }: { rails: RailDeclaration[] | undefined }) {
  const escrow = rails?.find((r) => r.id === "escrow");
  const escrowHref =
    escrow?.escrow && escrow.explorerTx ? escrow.explorerTx.replace(/\/tx\/\{tx\}$/, `/address/${escrow.escrow}`) : undefined;
  return (
    <section className="story__proof" aria-labelledby="proof-title">
      <h2 id="proof-title" className="story__line is-on">
        Check it without us.
      </h2>
      <ul className="story__proof-list">
        <li>
          <a href={`${REPO}/blob/main/docs/proof.md`} target="_blank" rel="noreferrer">
            docs/proof.md
          </a>
          <span>Every claim, with its explorer link.</span>
        </li>
        {escrowHref && escrow?.escrow ? (
          <li>
            <a href={escrowHref} target="_blank" rel="noreferrer">
              The escrow on Arc
            </a>
            <span className="mono">{shortHex(escrow.escrow, 6, 4)}</span>
          </li>
        ) : null}
        <li>
          <a href="https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078" target="_blank" rel="noreferrer">
            A Hedera payment on HashScan
          </a>
          <span>Settled on Hedera testnet, with its slip.</span>
        </li>
        <li>
          <Link to="/verify">Verify a slip</Link>
          <span>From its own bytes and a public RPC.</span>
        </li>
        <li>
          <a href={REPO} target="_blank" rel="noreferrer">
            The repository
          </a>
          <span>The code, the spec and the end-to-end runs.</span>
        </li>
      </ul>
      <p className="story__close">
        <Link to="/assistant" className="landing__go">
          Ask for a paid tool
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer" className="landing__cue">
          github.com/ss251/countersign ↗
        </a>
      </p>
      <p className="landing__fine">Testnets only. Every figure on this page is read from the hub while you look at it.</p>
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

/** The landing is dark unless light is pinned, so the phone's status bar follows it while it is open. */
function useDarkStatusBar() {
  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") return;
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const before = metas.map((m) => ({ m, content: m.content, media: m.media }));
    // After the shell's own theme effect has run, so this is the last word while the landing is open.
    const frame = requestAnimationFrame(() => {
      for (const m of metas) {
        m.media = "all";
        m.content = "#121210";
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const b of before) {
        b.m.content = b.content;
        b.m.media = b.media;
      }
    };
  }, []);
}
