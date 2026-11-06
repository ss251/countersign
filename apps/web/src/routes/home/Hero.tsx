import { useEffect, useRef, useState } from "react";
import { Link } from "../../app/router.tsx";
import { useThemeToggle } from "../../app/theme.ts";
import { formatAmount, usd } from "../../lib/format.ts";
import type { HubStats } from "../../lib/types.ts";
import { GlyphField } from "./GlyphField.tsx";

/*
 * Beat 1, the hero: the statement over a field of glyphs that swell in rings from the pointer, and
 * the hub's own figures under it. The field mounts after first paint, pauses whenever it is off
 * screen or the tab is hidden, and holds still under reduced motion. A plain gradient sits beneath
 * it, so the hero is never empty while it loads.
 */

export interface HeroProps {
  stats: HubStats | null;
  /** Why the figures are missing, when the hub never answered. */
  missing: string | undefined;
  railsLive: number | undefined;
  reduced: boolean;
  onDown: () => void;
}

export function Hero({ stats, missing, railsLive, reduced, onDown }: HeroProps) {
  const { current } = useThemeToggle();
  const box = useRef<HTMLElement>(null);
  const visible = useVisible(box);
  const [ready, setReady] = useState(false);
  // After first paint, never before: the statement must not wait on a shader.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section ref={box} className="hero" aria-labelledby="hero-title">
      <div className="hero__bg" aria-hidden="true">
        <div className="hero__poster" />
        {ready ? <GlyphField running={!reduced && visible} theme={current} target={box} /> : null}
        <div className="hero__veil" />
      </div>

      <div className="hero__inner">
        <p className="hero__kicker">
          Agent checkout, countersigned
        </p>
        <h1 id="hero-title" className="hero__title">
          Payments that only move when the work lands.
        </h1>
        <p className="hero__lede">
          Your agent buys tools inside limits you sign, and above them you countersign. On the escrow rails the money
          waits until the output checks out, and every settled call leaves a slip anyone can verify.
        </p>
        <div className="hero__actions">
          <Link to="/assistant" className="btn btn--primary hero__cta">
            Ask for a paid tool
          </Link>
          <Link to="/verify" className="btn hero__ghost">
            Verify a slip
          </Link>
        </div>

        <Figures stats={stats} missing={missing} railsLive={railsLive} />
      </div>

      <button type="button" className="hero__down" onClick={onDown}>
        <span>How it clears</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </section>
  );
}

/** The hub's own figures, read while you look. Never a fixture: with no read, it says so. */
export function Figures({ stats, missing, railsLive }: { stats: HubStats | null; missing: string | undefined; railsLive: number | undefined }) {
  if (!stats) {
    return (
      <p className="hero__figs hero__figs--wait" role="status">
        {missing ? `The hub did not answer, so there are no live figures right now.` : "Reading the hub…"}
      </p>
    );
  }
  return (
    <dl className="hero__figs" aria-label="Live from the hub">
      <div className="hero__fig">
        <dt>Jobs settled</dt>
        <dd className="num">{stats.delivered}</dd>
      </div>
      <div className="hero__fig">
        <dt>USDC settled</dt>
        <dd className="num">{formatAmount(usd(stats.volume))}</dd>
      </div>
      <div className="hero__fig">
        <dt>Offers listed</dt>
        <dd className="num">{stats.offers.listed}</dd>
      </div>
      {railsLive ? (
        <div className="hero__fig">
          <dt>Rails live</dt>
          <dd className="num">{railsLive}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Whether the element is on screen and the tab is visible: the glyphs draw only then. */
function useVisible(el: React.RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  const [tab, setTab] = useState(true);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { threshold: 0 });
    io.observe(node);
    const onVis = () => setTab(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [el]);
  return onScreen && tab;
}
