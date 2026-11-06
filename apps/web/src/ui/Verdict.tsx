import { networkName } from "../lib/format.ts";
import type { Verdict as VerdictData } from "../lib/verify.ts";
import { Button, Hash, cx } from "./primitives.tsx";
import "./verdict.css";

export interface ChainControl {
  /** The slip's release can be read from a public RPC. */
  can: boolean;
  busy: boolean;
  onRead: () => void;
  /** Explorer link for the settlement transaction, when it is a real one. */
  explorer?: string;
}

/**
 * The verifier's answer. VALID means every check that ran passed; the note under it
 * says which checks ran, so a verdict never claims more than was read.
 */
export function Verdict({ verdict, chain }: { verdict: VerdictData | null; chain?: ChainControl }) {
  if (!verdict) {
    return (
      <div className="verdict verdict--checking" role="status" aria-live="polite">
        <p className="verdict__word mono">CHECKING</p>
      </div>
    );
  }
  const asked = verdict.chain === "read" && verdict.network ? networkName(verdict.network) : null;
  return (
    <div className={cx("verdict", verdict.valid ? "verdict--valid" : "verdict--invalid")} role="status" aria-live="polite">
      <p className="verdict__word mono">{verdict.valid ? "VALID" : "INVALID"}</p>
      <p className="verdict__note">
        {asked
          ? `Hash and signatures checked in this browser. The release was read from ${asked}'s public RPC.`
          : "Hash and signatures checked in this browser. Nothing was sent anywhere and the chain was not asked."}
      </p>
      <ul className="verdict__checks">
        {verdict.checks.map((c) => (
          <li key={c.id} className={cx("vcheck", `vcheck--${c.state}`)}>
            <CheckGlyph state={c.state} />
            <div className="vcheck__text">
              <p className="vcheck__title">{c.title}</p>
              <p className="vcheck__detail">{c.detail}</p>
              {c.value ? (
                <p className="vcheck__value">
                  <Hash value={c.value} head={10} tail={8} href={c.href} label={c.title.toLowerCase()} />
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {chain && (chain.can || chain.explorer) && verdict.chain === "not-read" ? (
        <div className="verdict__actions">
          {chain.can ? (
            <Button variant="secondary" onClick={chain.onRead} disabled={chain.busy}>
              {chain.busy ? "Reading the chain" : "Check the chain"}
            </Button>
          ) : null}
          {chain.explorer ? (
            <a className="verdict__explorer" href={chain.explorer} target="_blank" rel="noreferrer">
              Open on the explorer
            </a>
          ) : null}
        </div>
      ) : null}
      {chain?.can && verdict.chain === "not-read" ? (
        <p className="verdict__fine">Check the chain reads one transaction receipt from a public RPC. It sends nothing else.</p>
      ) : null}
    </div>
  );
}

function CheckGlyph({ state }: { state: "pass" | "fail" | "info" }) {
  const label = state === "pass" ? "Passes:" : state === "fail" ? "Fails:" : "Not checked:";
  return (
    <svg className="vcheck__glyph" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={label}>
      {state === "pass" ? (
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ) : state === "fail" ? (
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      ) : (
        <circle cx="8" cy="8" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}
