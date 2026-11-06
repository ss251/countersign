import { useEffect, useRef, useState } from "react";
import { cx } from "../../ui/primitives.tsx";
import { browserCanPlay, clipSource, MEDIA, showsVideo } from "./media.ts";

export type StingRail = "arc" | "whitechain";

/**
 * A rail sting (STEER-0115): a letterboxed beat that plays its clip once, the first time most of it is in
 * view, then rests on its poster. The clip is not asked for until then; under reduced motion it never is,
 * and a clip that fails leaves the poster.
 */
export function RailSting({ rail, line, reduced }: { rail: StingRail; line: string; reduced: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"rest" | "playing" | "done" | "failed">("rest");

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setSrc(clipSource(`sting-${rail}`, browserCanPlay));
        io.disconnect();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rail, reduced]);

  return (
    <figure ref={ref} className="sting" data-testid={`sting-${rail}`}>
      <div className="sting__frame">
        <img
          className="sting__poster"
          src={`${MEDIA}sting-${rail}-poster.jpg`}
          alt=""
          width={1280}
          height={720}
          decoding="async"
          loading="lazy"
        />
        {showsVideo(reduced, state === "failed") ? (
          <video
            className={cx("sting__video", state === "playing" && "is-playing", state === "done" && "is-done")}
            src={src ?? undefined}
            muted
            playsInline
            autoPlay={src !== null}
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setState("playing")}
            onEnded={() => setState("done")}
            onError={() => setState("failed")}
          />
        ) : null}
        <div className="grain" aria-hidden="true" />
      </div>
      <figcaption className="sting__line">{line}</figcaption>
    </figure>
  );
}
