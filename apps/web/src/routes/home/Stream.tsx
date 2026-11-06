import type { CSSProperties } from "react";
import { formatAgo, formatAmount, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import type { RailDeclaration, Settlement } from "../../lib/types.ts";
import { cx } from "../../ui/primitives.tsx";
import { byTime, heldBy, keyOf, otherRailsLines } from "./field.ts";

/*
 * Beat 5, the evidence: the hub's last settlements as a live tape, newest first. Each row is one
 * payment as the hub recorded it: what was bought, from whom, for how much, on which rail, how long
 * ago, and its transaction on the chain's own explorer. Rows come only from the hub, never a fixture.
 */

const SHOWN = 8;

export interface StreamProps {
  rows: Settlement[];
  /** The first read of the settlements has come back, from anywhere. */
  loaded: boolean;
  rails: RailDeclaration[] | undefined;
  hubDown: boolean;
}

export function Stream({ rows, loaded, rails, hubDown }: StreamProps) {
  const newest = byTime(rows).reverse().slice(0, SHOWN);
  const others = otherRailsLines(rails);
  return (
    <section className="stream" aria-labelledby="stream-title">
      <div className="stream__head">
        <p className="section-kicker">
          Live from the hub
        </p>
        <h2 id="stream-title" className="stream__title">
          Every payment here was real.
        </h2>
        <p className="stream__lede">Each one left a slip anyone can check. The list reads again every ten seconds.</p>
      </div>

      {newest.length > 0 ? (
        <ol className="stream__list" aria-label="The latest settlements, newest first">
          {newest.map((s, i) => {
            const own = heldBy(s, rails, undefined);
            return (
              <li key={keyOf(s)} className="stream__row" style={{ "--i": i } as CSSProperties}>
                <span className={cx("stream__kind", `stream__kind--${s.kind}`)}>{KIND[s.kind]}</span>
                <span className="stream__what">
                  <span className="stream__title-text">{s.title || "Untitled offer"}</span>
                  <span className="stream__seller mono">{shortHex(s.seller)}</span>
                </span>
                <span className="stream__amount num">
                  {formatAmount(usd(s.amount, s.rail))}
                  <span className="stream__asset">{usd(s.amount, s.rail).asset.symbol}</span>
                </span>
                <span className="stream__rail">{RAIL_LABEL[s.rail] ?? s.rail}</span>
                <span className="stream__age num">{formatAgo(s.at)}</span>
                {own.txHref ? (
                  <a className="stream__tx" href={own.txHref} target="_blank" rel="noreferrer" aria-label={`Transaction for ${s.title || "this payment"} on the explorer`}>
                    tx ↗
                  </a>
                ) : (
                  <span className="stream__tx stream__tx--none" />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="stream__empty" role="status">
          {hubDown
            ? "The hub did not answer, so there are no live payments to show right now."
            : loaded
              ? "No payment has moved on this hub yet. The first one lands here, with its slip."
              : "Reading the hub…"}
        </p>
      )}

      {others.length > 0 ? (
        <ul className="stream__notes">
          {others.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const KIND: Record<Settlement["kind"], string> = {
  released: "Released",
  settled: "Settled",
  refunded: "Refunded",
};
