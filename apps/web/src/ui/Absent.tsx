import type { ReactNode } from "react";

/**
 * A read the hub could not give, said plainly: what is missing, a way to try again, and anything
 * the person can do about it. Never a stand-in in its place.
 */
export function Absent({ reason, onRetry, children }: { reason: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div className="absent" role="status">
      <p className="absent__reason">{reason}</p>
      {children}
      {onRetry ? (
        <button type="button" className="absent__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
