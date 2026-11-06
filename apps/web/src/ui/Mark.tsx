import { MARK_INK, MARK_SEAL } from "./mark-paths.ts";
import "./mark.css";

interface MarkProps {
  size?: number;
  /** Accessible name. Without it the mark is decorative. */
  title?: string;
  className?: string;
}

/** Two strokes meeting on a vertical seam: the offer in ink on the left, the countersignature in blue ink on the right. */
export function Mark({ size = 24, title, className }: MarkProps) {
  return (
    <svg
      className={className ? `mark ${className}` : "mark"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path className="mark__ink" d={MARK_INK} />
      <path className="mark__seal" d={MARK_SEAL} />
    </svg>
  );
}

/** The mark and the name. Lowercase, in the house display face. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: `${Math.round(size * 0.7)}px` }}>
      <Mark size={size} />
      <span className="wordmark__name">countersign</span>
    </span>
  );
}
