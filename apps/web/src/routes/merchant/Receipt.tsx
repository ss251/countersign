import { useEffect, useState } from "react";
import type { ReceiptOrder } from "./model.ts";
import {
  addressUrl,
  formatUsdt,
  humanDate,
  itemLabel,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  txUrl,
} from "./model.ts";
import { fetchOfferTitle, fetchRelayOrder } from "./api.ts";
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

/** A line of the receipt's ledger: what was paid, and every amount that went back. */
interface LedgerLine {
  label: string;
  amount: bigint;
  txHash?: string;
}

export function Receipt({ id, fixture }: ReceiptProps) {
  const [state, setState] = useState<ReceiptState>(() => (fixture ? fixtureState(id) : { kind: "loading" }));
  const [hubTitle, setHubTitle] = useState<string | null>(null);

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
        <section className="mx-receipt mx-receipt--message" aria-busy={state.kind === "loading"}>
          <p className="mx-receipt__brand">countersign · receipt</p>
          {state.kind === "missing" ? <p className="mx-receipt__message">No order with that id.</p> : null}
          {state.kind === "error" ? <p className="mx-receipt__message">{state.message}</p> : null}
        </section>
      </div>
    );
  }

  const order = state.order;
  const tone = statusTone(order.status);
  const amount = BigInt(order.amount);
  const item = itemLabel(order, hubTitle);

  // Money that went back: transfer refunds, or the whole amount when the escrow was cancelled or ran out.
  const returned: LedgerLine[] = [];
  const refundTxs = order.refunds?.length ? order.refunds : order.refundTxs.map((txHash) => ({ txHash, amount: undefined }));
  for (const refund of refundTxs) {
    const value = refund.amount ?? (refundTxs.length === 1 ? order.refunded : undefined);
    returned.push({
      label: `Returned to ${shortAddress(order.customer)}`,
      amount: value ? BigInt(value) : 0n,
      txHash: refund.txHash,
    });
  }
  if ((order.closeKind === "cancel" || order.closeKind === "deadline_refund") && order.closeTx) {
    returned.push({ label: `Returned to ${shortAddress(order.customer)}`, amount, txHash: order.closeTx });
  }
  const returnedTotal = returned.reduce((sum, line) => sum + line.amount, 0n);
  const net = amount - returnedTotal;
  const close = closeWords(order.closeKind);

  return (
    <div className="mx-receipt-page">
      <article className="mx-receipt" aria-labelledby="mx-receipt-status">
        <p className="mx-receipt__brand">countersign · receipt</p>
        <h1 className={`mx-receipt__status mx-receipt__status--${tone}`} id="mx-receipt-status">
          {statusLabel(order.status)}
        </h1>
        <p className="mx-receipt__amount num">
          {formatUsdt(order.amount)}
          <span className="mx-receipt__unit">USDT</span>
        </p>
        <ReceiptId id={order.id} />

        <dl className="mx-ledger">
          <div className="mx-ledger__line">
            <dt>{item}</dt>
            <dd className="num">{formatUsdt(order.amount)} USDT</dd>
          </div>
          {returned.map((line, index) => (
            <div className="mx-ledger__line mx-ledger__line--back" key={`${line.txHash ?? "line"}-${index}`}>
              <dt>{line.label}</dt>
              <dd className="num">
                {line.amount > 0n ? `−${formatUsdt(line.amount.toString())} USDT` : "Returned"}
              </dd>
            </div>
          ))}
          {returned.length > 0 ? (
            <div className="mx-ledger__line mx-ledger__line--total">
              <dt>Paid in the end</dt>
              <dd className="num">{formatUsdt((net > 0n ? net : 0n).toString())} USDT</dd>
            </div>
          ) : null}
        </dl>

        <dl className="mx-facts">
          <div className="mx-fact">
            <dt>Paid to</dt>
            <dd>
              <a className="mono" href={addressUrl(order.merchant)} title={order.merchant}>
                {shortAddress(order.merchant)}
              </a>
            </dd>
          </div>
          <div className="mx-fact">
            <dt>From</dt>
            <dd>
              <a className="mono" href={addressUrl(order.customer)} title={order.customer}>
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
          <div className="mx-fact">
            <dt>Payment</dt>
            <dd>
              <a className="mono" href={txUrl(order.settleTx)} title={order.settleTx}>
                {shortHash(order.settleTx)}
              </a>
            </dd>
          </div>
          {close && order.closeTx ? (
            <div className="mx-fact">
              <dt>{close.term}</dt>
              <dd>
                <a className="mono" href={txUrl(order.closeTx)} title={order.closeTx}>
                  {shortHash(order.closeTx)}
                </a>
                <span className="mx-fact__note">{close.words}</span>
              </dd>
            </div>
          ) : null}
          {returned
            .filter((line) => line.txHash && line.txHash !== order.closeTx)
            .map((line) => (
              <div className="mx-fact" key={line.txHash}>
                <dt>Refund</dt>
                <dd>
                  <a className="mono" href={txUrl(line.txHash!)} title={line.txHash}>
                    {shortHash(line.txHash!)}
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
      <span className="mx-muted">Receipt</span>{" "}
      <span className="mono" title={id}>
        {shortHash(id)}
      </span>
      <button
        type="button"
        className="mx-button mx-button--quiet mx-button--small"
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

/** How the escrow finished, in the customer's words. */
function closeWords(kind: ReceiptOrder["closeKind"]): { term: string; words: string } | null {
  switch (kind) {
    case "release":
      return { term: "Released", words: "Delivered, then paid to the merchant." };
    case "cancel":
      return { term: "Cancelled", words: "Cancelled by the merchant. Full amount returned." };
    case "deadline_refund":
      return { term: "Refunded", words: "Refunded after the deadline. Full amount returned." };
    default:
      return null;
  }
}
