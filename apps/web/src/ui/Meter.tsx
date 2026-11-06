import "./ui.css";

/** A spent-of-cap bar. The filled part is money, so it is blue. */
export function Meter({ value, max, label }: { value: bigint; max: bigint; label: string }) {
  const ratio = max > 0n ? Number((value * 10_000n) / max) / 10_000 : 0;
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${Math.round(pct)} percent`}
    >
      <span className="meter__fill" style={{ transform: `scaleX(${pct / 100})` }} />
    </div>
  );
}
