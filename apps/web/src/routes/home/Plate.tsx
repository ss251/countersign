import { useEffect, useState } from "react";
import { cx } from "../../ui/primitives.tsx";
import { browserCanPlay, clipSource, devPlateSource, MEDIA, showsVideo } from "./media.ts";

/**
 * The front plate (STEER-0115): a letterboxed still of black paper with a thread running lower left to
 * upper right, and one line of type in the empty top left. Monumental and slow: the poster paints first,
 * the loop is asked for only after first paint and fades in over it, never under reduced motion, and a
 * clip that fails leaves the poster. A flat ink scrim keeps the line at 9.6:1 against the brightest pixel
 * behind it. The plate keeps its own deep blacks in either theme.
 */
export function HeroPlate({ reduced }: { reduced: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (reduced) return;
    // After first paint: the poster is on screen before a byte of the loop is asked for.
    const start = () => setSrc(devPlateSource() ?? clipSource("hero", browserCanPlay));
    const idle = (window as Partial<Window>).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(start, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 600);
    return () => window.clearTimeout(timer);
  }, [reduced]);

  return (
    <section className="plate" aria-labelledby="statement">
      <div className="plate__frame">
        <img className="plate__poster" src={`${MEDIA}hero-poster.jpg`} alt="" width={1920} height={1080} decoding="async" fetchPriority="high" />
        {showsVideo(reduced, failed) ? (
          <video
            className={cx("plate__video", playing && "is-playing")}
            src={src ?? undefined}
            muted
            playsInline
            loop
            autoPlay={src !== null}
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onError={() => setFailed(true)}
          />
        ) : null}
        <div className="plate__scrim" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <h1 id="statement" className="plate__line">
          payments that only move when the work lands.
        </h1>
      </div>
    </section>
  );
}
