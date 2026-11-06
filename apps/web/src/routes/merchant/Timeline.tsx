import type { TimelineEvent } from "./model.ts";
import { formatBlock, humanDate, shortHash, shortHumanDate, txUrl } from "./model.ts";

/**
 * What happened to an order, newest first. Every step names its proof: the transaction, and the
 * slip hash where the escrow released. The merchant's panel and the customer's receipt share it,
 * so both read the same evidence.
 */
export function Timeline({ events, labelledBy }: { events: readonly TimelineEvent[]; labelledBy: string }) {
  return (
    <ol className="mx-tl" aria-labelledby={labelledBy}>
      {events.map((event) => (
        <li className={`mx-tl__step mx-tl__step--${event.tone}`} key={event.key}>
          <span className="mx-tl__dot" aria-hidden="true" />
          <div className="mx-tl__body">
            <p className="mx-tl__title">{event.title}</p>
            {event.detail ? <p className="mx-tl__detail">{event.detail}</p> : null}
            {event.txHash || event.slipHash ? (
              <p className="mx-tl__proof">
                {event.txHash ? (
                  <a
                    className="mono mx-tx"
                    href={txUrl(event.txHash)}
                    title={`${event.txHash} on the Whitechain explorer`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortHash(event.txHash)}
                  </a>
                ) : null}
                {event.slipHash ? (
                  <span className="mx-tl__slip" title={event.slipHash}>
                    slip <span className="mono">{shortHash(event.slipHash)}</span>
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <span className="mx-tl__when num">
            {event.at ? (
              <time dateTime={new Date(event.at).toISOString()} title={humanDate(event.at)}>
                {shortHumanDate(event.at)}
              </time>
            ) : event.block ? (
              <span title="The relay records the block, not the time, for this step.">block {formatBlock(event.block)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
