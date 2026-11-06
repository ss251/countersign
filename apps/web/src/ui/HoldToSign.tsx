import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./primitives.tsx";
import "./hold.css";

/*
 * The countersignature, as a gesture: a pill you hold. Steel sweeps across it under the thumb,
 * linear so it shows exactly how much of the hold is done, and the mark beside the label draws
 * its second stroke, the countersignature, in step. Let go early and both snap back. When it
 * completes the pill turns green.
 *
 * Two copies of the content, one over the other: the top copy is the filled state, clipped to
 * the progress. The colour changes exactly at the sweep's edge, which no colour transition can do.
 */

const VIEW_W = 300;
const VIEW_H = 64;
const SEAM_X = 150;
const INK_D = "M 14 46 C 30 8, 104 4, 150 31";
const SEAL_D = "M 150 31 C 196 58, 270 54, 286 16";

type Phase = "idle" | "holding" | "done";

export interface HoldToSignProps {
  onSigned: () => void;
  /** Accessible name, e.g. "Countersign 0.05 USDC to use-arc". */
  ariaLabel: string;
  /** Names under the two halves of the line. */
  left: string;
  right: string;
  label?: string;
  holdingLabel?: string;
  doneLabel?: string;
  /** Milliseconds the hold takes. */
  duration?: number;
  disabled?: boolean;
  /** Start in the signed state, e.g. when returning to a countersigned job. */
  signed?: boolean;
}

export function HoldToSign({
  onSigned,
  ariaLabel,
  left,
  right,
  label = "Hold to countersign",
  holdingLabel = "Keep holding",
  doneLabel = "Countersigned",
  duration = 1100,
  disabled = false,
  signed = false,
}: HoldToSignProps) {
  const sealRef = useRef<SVGPathElement>(null);
  const sealTopRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const length = useRef(0);
  const progress = useRef(0);
  const frame = useRef(0);
  const startedAt = useRef(0);
  const phaseRef = useRef<Phase>(signed ? "done" : "idle");
  const [phase, setPhaseState] = useState<Phase>(phaseRef.current);
  const hintId = useId();
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const paint = (p: number) => {
    progress.current = p;
    for (const path of [sealRef.current, sealTopRef.current]) {
      if (path) path.style.strokeDashoffset = String(length.current * (1 - p));
    }
    if (fillRef.current) fillRef.current.style.clipPath = `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0 round 999px)`;
  };

  useLayoutEffect(() => {
    const path = sealRef.current;
    if (!path) return;
    length.current = typeof path.getTotalLength === "function" ? path.getTotalLength() : 160;
    for (const p of [sealRef.current, sealTopRef.current]) {
      if (p) p.style.strokeDasharray = `${length.current} ${length.current + 8}`;
    }
    paint(phaseRef.current === "done" ? 1 : 0);
  }, []);

  useEffect(() => {
    if (signed && phaseRef.current !== "done") {
      setPhase("done");
      paint(1);
    }
  }, [signed]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const tick = (now: number) => {
    // Linear on purpose: the stroke shows exactly how much of the hold is done.
    const t = Math.min(1, (now - startedAt.current) / duration);
    paint(t);
    if (t >= 1) {
      setPhase("done");
      navigator.vibrate?.(12);
      onSignedRef.current();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };

  const start = () => {
    if (disabled || phaseRef.current !== "idle") return;
    cancelAnimationFrame(frame.current);
    // Resume from wherever a retraction left the stroke.
    startedAt.current = performance.now() - progress.current * duration;
    setPhase("holding");
    frame.current = requestAnimationFrame(tick);
  };

  const release = () => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(frame.current);
    setPhase("idle");
    const from = progress.current;
    const t0 = performance.now();
    const back = (now: number) => {
      // Letting go early snaps back fast: the system answers, the user is not kept waiting.
      const k = Math.min(1, (now - t0) / 150);
      paint(from * (1 - (1 - (1 - k) ** 3)));
      if (k < 1 && phaseRef.current === "idle") frame.current = requestAnimationFrame(back);
    };
    frame.current = requestAnimationFrame(back);
  };

  const isKey = (key: string) => key === " " || key === "Enter";

  return (
    <button
      type="button"
      className={cx("hold", `hold--${phase}`)}
      data-phase={phase}
      aria-label={ariaLabel}
      aria-describedby={hintId}
      aria-disabled={disabled || phase === "done" || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if (!isKey(e.key)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (!isKey(e.key)) return;
        e.preventDefault();
        release();
      }}
      onBlur={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <HoldFace label={phase === "done" ? doneLabel : phase === "holding" ? holdingLabel : label} sealRef={sealRef} />
      <span ref={fillRef} className="hold__fill" aria-hidden="true">
        <HoldFace label={phase === "done" ? doneLabel : holdingLabel} sealRef={sealTopRef} />
      </span>
      <span id={hintId} className="sr-only">
        {`Press and hold for about a second to countersign from ${left} to ${right}. Letting go early cancels.`}
      </span>
      <span className="sr-only" aria-live="polite">
        {phase === "holding" ? "Keep holding." : phase === "done" ? `${doneLabel}.` : ""}
      </span>
    </button>
  );
}

/** One face of the pill: the mark, its second stroke drawn by the hold, and the label. */
function HoldFace({ label, sealRef }: { label: string; sealRef: React.RefObject<SVGPathElement | null> }) {
  return (
    <span className="hold__face" aria-hidden="true">
      <svg className="hold__svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} focusable="false">
        <path className="hold__ink" d={INK_D} />
        <path ref={sealRef} className="hold__seal" d={SEAL_D} />
        <rect className="hold__seam" x={SEAM_X - 3} y="0" width="6" height={VIEW_H} />
      </svg>
      <span className="hold__label">{label}</span>
    </span>
  );
}
