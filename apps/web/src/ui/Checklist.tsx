import type { Check, CheckKind } from "../lib/checklist.ts";
import { cx } from "./primitives.tsx";

/** One ruled line per rule: a tick, a red cross only for a real refusal, or the dot that means it needs you. */
export function Checklist({ items, className }: { items: Check[]; className?: string }) {
  return (
    <ul className={cx("checks__list", className)}>
      {items.map((c, i) => (
        <li key={i} className={cx("check", `check--${c.kind}`)}>
          <CheckGlyph kind={c.kind} />
          <span className="check__text num">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function CheckGlyph({ kind }: { kind: CheckKind }) {
  if (kind === "pass") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Passes:">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "fail") {
    return (
      <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Refused:">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="check__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Needs you:">
      <circle cx="8" cy="8" r="2.6" fill="currentColor" />
    </svg>
  );
}
