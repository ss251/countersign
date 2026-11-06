import { useEffect, useId, useState } from "react";
import type { ReceiptOrder } from "./model.ts";
import {
  addressUrl,
  decimalsFor,
  formatFixed,
  formatUsdt,
  humanDate,
  itemLabel,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  timeline,
} from "./model.ts";
import { fetchOfferTitle, fetchRelayOrder } from "./api.ts";
import { findFixtureOrder } from "./fixtures.ts";
import { Timeline } from "./Timeline.tsx";

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

/** Money that went back to the customer: each transfer refund, or the whole amount on a cancel. */
function returnedLines(order: ReceiptOrder): bigint[] {
  if (order.closeKind === "cancel" || order.closeKind === "deadline_refund") return [BigInt(order.amount)];
  const records = order.refunds?.length ? order.refunds : order.refundTxs.map(() => ({ amount: undefined }));
  return records.map((refund) => {
    const value = refund.amount ?? (records.length === 1 ? order.refunded : undefined);
    return value ? BigInt(value) : 0n;
  });
}

function Unit() {
  return <span className="mx-unit">USDT</span>;
}

export function Receipt({ id, fixture }: ReceiptProps) {
  const [state, setState] = useState<ReceiptState>(() => (fixture ? fixtureState(id) : { kind: "loading" }));
  const [hubTitle, setHubTitle] = useState<string | null>(null);
  const statusId = useId();
  const proofId = useId();

  useEffect(() => {
    if (fixture) {
      setState(fixtureState(id));
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchRelayOrder(id)
      .then((order) => {
        if (!cancelled) setState(order ? { kind: "ready", order } : { kind: "missing" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "The receipt could not be loaded." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, id]);

  const offerHash = state.kind === "ready" && !state.order.description ? state.order.offerHash : undefined;
  useEffect(() => {
    if (fixture || !offerHash) return;
    let cancelled = false;
    void fetchOfferTitle(offerHash).then((title) => {
      if (!cancelled) setHubTitle(title);
    });
    return () => {
      cancelled = true;
    };
  }, [fixture, offerHash]);

  if (state.kind !== "ready") {
    return (
      <div className="mx-receipt-page">
        <section className="mx-receipt" aria-busy={state.kind === "loading"}>
          <p className="mx-receipt__brand">countersign · receipt</p>
          {state.kind === "missing" ? <p className="mx-receipt__message">No order with that id.</p> : null}
          {state.kind === "error" ? <p className="mx-receipt__message">{state.message}</p> : null}
        </section>
      </div>
    );
  }

  const order = state.order;
  const amount = BigInt(order.amount);
  const returned = returnedLines(order);
  const returnedTotal = returned.reduce((sum, value) => sum + value, 0n);
  const kept = amount > returnedTotal ? amount - returnedTotal : 0n;
  const places = decimalsFor([amount, kept, ...returned]);
  const inFlight = order.status === "held" || order.status === "pending";

  return (
    <div className="mx-receipt-page">
      <article className="mx-receipt" aria-labelledby={statusId}>
        <p className="mx-receipt__brand">countersign · receipt{fixture ? " · sample" : ""}</p>
        <h1 className="mx-receipt__status" id={statusId}>
          <span className={`mx-dot mx-dot--${statusTone(order.status)}`} aria-hidden="true" />
          {statusLabel(order.status)}
        </h1>
        <p className={`mx-receipt__amount mono${inFlight ? " mx-money" : ""}`}>
          {formatUsdt(order.amount)}
          <Unit />
        </p>
        <p className="mx-receipt__item">{itemLabel(order, hubTitle)}</p>
        <ReceiptId id={order.id} />

        {returned.length > 0 ? (
          <dl className="mx-sum">
            <div className="mx-sum__line">
              <dt>Paid</dt>
              <dd className="mono">
                {formatFixed(amount, places)}
                <Unit />
              </dd>
            </div>
            {returned.map((value, index) => (
              <div className="mx-sum__line mx-sum__line--less" key={index}>
                <dt>Returned to you</dt>
                <dd className="mono">
                  {value > 0n ? (
                    <>
                      −{formatFixed(value, places)}
                      <Unit />
                    </>
                  ) : (
                    "Returned"
                  )}
                </dd>
              </div>
            ))}
            <div className="mx-sum__line mx-sum__line--total">
              <dt>You paid</dt>
              <dd className="mono">
                {formatFixed(kept, places)}
                <Unit />
              </dd>
            </div>
          </dl>
        ) : null}

        <dl className="mx-facts">
          <div className="mx-fact">
            <dt>Paid to</dt>
            <dd>
              <a className="mono" href={addressUrl(order.merchant)} title={order.merchant} target="_blank" rel="noreferrer">
                {shortAddress(order.merchant)}
              </a>
            </dd>
          </div>
          <div className="mx-fact">
            <dt>From</dt>
            <dd>
              <a className="mono" href={addressUrl(order.customer)} title={order.customer} target="_blank" rel="noreferrer">
                {shortAddress(order.customer)}
              </a>
            </dd>
          </div>
          <div className="mx-fact">
            <dt>Date</dt>
            <dd className="num">
              <time dateTime={new Date(order.createdAt).toISOString()}>{humanDate(order.createdAt)}</time>
            </dd>
          </div>
          <div className="mx-fact">
            <dt>Network</dt>
            <dd>Whitechain Sepolia</dd>
          </div>
        </dl>

        <section className="mx-receipt__proof" aria-labelledby={proofId}>
          <h2 className="mx-label" id={proofId}>
            What happened
          </h2>
          <Timeline events={timeline(order, "customer")} labelledBy={proofId} />
        </section>

        <p className="mx-receipt__footer">
          Every step above is a transaction on Whitechain. Anyone can check it on the explorer, with or without
          countersign.
        </p>
      </article>
    </div>
  );
}

/** The receipt id, copyable; the button says so for a moment once it has. */
function ReceiptId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <p className="mx-receipt__id">
      <span className="mx-label">Receipt</span>
      <span className="mono" title={id}>
        {shortHash(id)}
      </span>
      <button
        type="button"
        className="mx-button mx-button--quiet mx-button--small"
        aria-label={copied ? "Receipt id copied" : "Copy the receipt id"}
        onClick={() => {
          void navigator.clipboard
            .writeText(id)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}
