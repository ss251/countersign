import type { Verdict as VerdictData } from "../lib/verify.ts";
import { Hash, cx } from "./primitives.tsx";
import "./verdict.css";

/** The verifier's answer: VALID or INVALID, then each check and how it was made. */
export function Verdict({ verdict, compact = false }: { verdict: VerdictData | null; compact?: boolean }) {
  if (!verdict) {
    return (
      <div className="verdict verdict--checking" role="status" aria-live="polite">
        <p className="verdict__word mono">CHECKING</p>
      </div>
    );
  }
  return (
    <div className={cx("verdict", verdict.valid ? "verdict--valid" : "verdict--invalid", compact && "verdict--compact")} role="status" aria-live="polite">
      <p className="verdict__word mono">{verdict.valid ? "VALID" : "INVALID"}</p>
      <p className="verdict__note">Checked in this browser from the slip alone. No hub was asked.</p>
      <ul className="verdict__checks">
        {verdict.checks.map((c) => (
          <li key={c.id} className={cx("vcheck", `vcheck--${c.state}`)}>
            <svg className="vcheck__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={c.state === "pass" ? "Passes:" : "Fails:"}>
              {c.state === "pass" ? (
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              )}
            </svg>
            <div className="vcheck__text">
              <p className="vcheck__title">{c.title}</p>
              {compact ? null : <p className="vcheck__detail">{c.detail}</p>}
              {c.value && !compact ? (
                <p className="vcheck__value">
                  <Hash value={c.value} head={10} tail={8} label={c.title.toLowerCase()} />
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
