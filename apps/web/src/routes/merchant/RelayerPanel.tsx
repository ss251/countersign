import type { ReactNode } from "react";
import {
  addressUrl,
  bpsPercent,
  formatGwei,
  formatWbt,
  formatWeiWbt,
  shortAddress,
  type RelayStatus,
} from "./model.ts";

/** "at 23:40", in the merchant's own clock; nothing when the relay gave no time. */
function resetsAt(value: number | string): string {
  const at = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Address({ value }: { value: string }) {
  return (
    <a className="mono" href={addressUrl(value)} title={value} target="_blank" rel="noreferrer">
      {shortAddress(value)}
    </a>
  );
}

function List({ values }: { values: string[] | undefined }) {
  if (!values || values.length === 0) return <span className="mx-quiet">Any</span>;
  return (
    <span className="mx-relayer__list">
      {values.map((value, index) => (
        <span key={value}>
          {index > 0 ? <span aria-hidden="true">, </span> : null}
          <Address value={value} />
        </span>
      ))}
    </span>
  );
}

/**
 * The Whitechain relayer that pays every customer's gas, read live from the relay's GET /status:
 * how the business funds it, and the guards that stop anyone draining it (STEER-2210, Scale).
 */
export function RelayerPanel({ status }: { status: RelayStatus }): ReactNode {
  const policy = status.policy;
  const funding = status.funding ?? null;
  const ceiling = status.ceiling;
  const reset = resetsAt(ceiling.resetsAt);

  return (
    <section className="mx-relayer" aria-labelledby="mx-relayer-heading">
      <div className="mx-relayer__head">
        <h2 className="mx-label" id="mx-relayer-heading">
          Gas relayer
        </h2>
        <p className="mx-relayer__lead">Customers pay no gas. This relayer pays it, within these limits.</p>
      </div>

      <dl className="mx-facts mx-relayer__facts">
        <div className="mx-fact">
          <dt>Relayer</dt>
          <dd>
            <Address value={status.address} />
          </dd>
        </div>
        <div className="mx-fact">
          <dt>Fund it</dt>
          <dd>Send WBT to the relayer on Whitechain</dd>
        </div>
        <div className="mx-fact">
          <dt>Balance</dt>
          <dd className="num">{formatWbt(status.balanceWbt)} WBT</dd>
        </div>
        {policy ? (
          <div className="mx-fact">
            <dt>Balance floor</dt>
            <dd className="num">Stops at {formatWeiWbt(policy.minBalanceWei)} WBT</dd>
          </div>
        ) : null}
        <div className="mx-fact">
          <dt>This hour</dt>
          <dd className="num">
            {formatWeiWbt(ceiling.usedWei)} of {formatWeiWbt(ceiling.capWei)} WBT, {ceiling.txCount} of {ceiling.maxTx}{" "}
            transactions{reset ? `, resets at ${reset}` : ""}
          </dd>
        </div>
        {policy ? (
          <div className="mx-fact">
            <dt>Fee cap</dt>
            <dd className="num">{formatGwei(policy.maxFeePerGasWei)} gwei max fee per gas</dd>
          </div>
        ) : null}
        {policy ? (
          <>
            <div className="mx-fact">
              <dt>Tokens</dt>
              <dd>
                <List values={policy.allowedTokens} />
              </dd>
            </div>
            <div className="mx-fact">
              <dt>Escrows</dt>
              <dd>
                <List values={policy.allowedEscrows} />
              </dd>
            </div>
            <div className="mx-fact">
              <dt>Merchants</dt>
              <dd>
                <List values={policy.allowedPayees} />
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {funding ? (
        <p className="mx-relayer__funding">
          Every escrow release keeps a toll of <span className="num">{bpsPercent(funding.tollBps)}</span>. The fee split{" "}
          <Address value={funding.feeSplit} /> pays the relayer <span className="num">{bpsPercent(funding.relayerShareBps)}</span>{" "}
          of it
          {funding.feeSplitUsdt !== null ? (
            <>
              , and holds <span className="num">{funding.feeSplitUsdt} USDT</span> to pay out now
            </>
          ) : null}
          .
        </p>
      ) : null}
    </section>
  );
}
