import { useEffect, useState } from "react";
import type { ReceiptOrder } from "./model.ts";
import {
  addressUrl,
  formatDateTime,
  formatUsdt,
  settlementOutcome,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  txUrl,
} from "./model.ts";
import { fetchRelayOrder } from "./api.ts";
import { findFixtureOrder } from "./fixtures.ts";

interface ReceiptProps {
  id: string;
  fixture: boolean;
}

type ReceiptState =
  | { kind: "loading" }
  | { kind: "ready"; order: ReceiptOrder }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function fixtureState(id: string): ReceiptState {
  const order = findFixtureOrder(id);
  return order ? { kind: "ready", order } : { kind: "missing" };
}

export function Receipt({ id, fixture }: ReceiptProps) {
  const [state, setState] = useState<ReceiptState>(() =>
    fixture ? fixtureState(id) : { kind: "loading" },
  );

  useEffect(() => {
    if (fixture) {
      setState(fixtureState(id));
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchRelayOrder(id)
      .then((order) => {
        if (cancelled) return;
        setState(order ? { kind: "ready", order } : { kind: "missing" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "The receipt could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, id]);

  if (state.kind === "loading") {
    return (
      <div className="mx-receipt-page">
        <section className="mx-receipt mx-receipt--message" aria-busy="true">
          <h1 className="mx-receipt__kicker">Receipt</h1>
        </section>
      </div>
    );
  }

  if (state.kind === "missing" || state.kind === "error") {
    return (
      <div className="mx-receipt-page">
        <section className="mx-receipt mx-receipt--message">
          <h1 className="mx-receipt__kicker">Receipt</h1>
          <p className="mx-receipt__message">
            {state.kind === "missing" ? "No order with that id." : state.message}
          </p>
        </section>
      </div>
    );
  }

  const order = state.order;
  const tone = statusTone(order.status);
  const outcome = settlementOutcome(order);
  const refundRecords = order.refunds ?? [];
  const refundTxs = order.refundTxs ?? [];
  const refunds =
    refundRecords.length > 0
      ? refundRecords.map((refund) => ({
          amount: refund.amount ?? (refundRecords.length === 1 ? order.refunded : undefined),
          txHash: refund.txHash,
        }))
      : refundTxs.map((txHash) => ({
          amount: refundTxs.length === 1 ? order.refunded : undefined,
          txHash,
        }));

  return (
    <div className="mx-receipt-page">
      <article className="mx-receipt" aria-labelledby="mx-receipt-title">
        <h1 className="mx-receipt__kicker" id="mx-receipt-title">
          Receipt
        </h1>
        <p className="mx-receipt__amount num">{formatUsdt(order.amount)} USDT</p>
        <div className="mx-receipt__parties">
          <p className="mx-receipt__party">
            Paid to{" "}
            <a className="mono" href={addressUrl(order.merchant)} title={order.merchant}>
              {shortAddress(order.merchant)}
            </a>
          </p>
          <p className="mx-receipt__party">
            from{" "}
            <a className="mono" href={addressUrl(order.customer)} title={order.customer}>
              {shortAddress(order.customer)}
            </a>
          </p>
        </div>
        <div className="mx-receipt__status">
          <span className={`mx-pill mx-pill--${tone}`}>{statusLabel(order.status)}</span>
        </div>
        <dl className="mx-receipt__facts">
          <div className="mx-receipt__fact">
            <dt>Date</dt>
            <dd className="num">
              <time dateTime={new Date(order.createdAt).toISOString()}>
                {formatDateTime(order.createdAt)}
              </time>
            </dd>
          </div>
          <div className="mx-receipt__fact">
            <dt>Network</dt>
            <dd>Whitechain Sepolia</dd>
          </div>
          <div className="mx-receipt__fact">
            <dt>Settlement</dt>
            <dd>
              <a
                className="mono"
                href={txUrl(order.settleTx)}
                title={order.settleTx}
                aria-label={`Settlement transaction ${order.settleTx}`}
              >
                {shortHash(order.settleTx)}
              </a>
            </dd>
          </div>
          {outcome ? (
            <div className="mx-receipt__fact">
              <dt>Outcome</dt>
              <dd>
                {outcome.label}{" "}
                <a
                  className="mono"
                  href={txUrl(outcome.txHash)}
                  title={outcome.txHash}
                  aria-label={`Close transaction ${outcome.txHash}`}
                >
                  {shortHash(outcome.txHash)}
                </a>
              </dd>
            </div>
          ) : null}
          {refunds.map((refund, index) => (
            <div className="mx-receipt__fact" key={`${refund.txHash}-${index}`}>
              <dt>Refund</dt>
              <dd>
                {refund.amount ? (
                  <span className="num mx-amount--money">{formatUsdt(refund.amount)} USDT </span>
                ) : null}
                <a
                  className="mono"
                  href={txUrl(refund.txHash)}
                  title={refund.txHash}
                  aria-label={`Refund transaction ${refund.txHash}`}
                >
                  {shortHash(refund.txHash)}
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mx-receipt__footer">
          This record is on chain. Anyone can check it on the explorer, with or without countersign.
        </p>
      </article>
    </div>
  );
}
