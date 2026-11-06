import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link } from "../../app/router.tsx";
import type { Order, ReceiptOrder, Refusal, RefundReason } from "./model.ts";
import {
  REFUND_REASONS,
  addressUrl,
  adjustments,
  assetOf,
  canRefund,
  checkRefundAmount,
  contribution,
  decimalsFor,
  explorerOf,
  formatFixed,
  formatUsdt,
  humanDate,
  isWhitechain,
  networkNameOf,
  refundLabel,
  refusalWords,
  shortAddress,
  statusLabel,
  statusTone,
  timeline,
} from "./model.ts";
import { Timeline } from "./Timeline.tsx";

/** One click refunds; this is the window to take it back before anything is signed. */
export const UNDO_MS = 4000;

/** Where an order's one-click refund stands. Absent means nothing was asked. */
export type RowState =
  | { kind: "undo" }
  | { kind: "sending" }
  /** `before` is what was refundable when it was sent, to tell a stale list from an updated one. */
  | { kind: "done"; txHash: string; amount: string; cancelled: boolean; before: string }
  | { kind: "error"; message: string };

/**
 * May this order be refunded from here right now? Not while a refund is in its undo window or on
 * its way, and not until the list has caught up with one that just went out, so a stale remainder
 * can never be offered twice.
 */
export function offersRefund(order: Order, row: RowState | undefined): boolean {
  if (row?.kind === "undo" || row?.kind === "sending") return false;
  if (row?.kind === "done" && order.refundable === row.before) return false;
  return canRefund(order);
}

export type PartOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Who can refund from this page. A refund is signed with the merchant's own key, which stays on the
 * merchant's machine inside the merchant service; the page can only ask that service. "sample" is
 * the ?hub=off ledger, where refunds are simulated and say so. Nothing else ever simulates one.
 */
export type RefundAccess =
  | { kind: "sample" }
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "locked" }
  /** The merchant service is out of reach, or it signs for another merchant (`signer`). */
  | { kind: "away"; signer: string | null };

export function canAct(access: RefundAccess): boolean {
  return access.kind === "sample" || access.kind === "ready";
}

/** Why this page cannot refund, in one sentence the merchant can act on. */
export function awayWords(access: Extract<RefundAccess, { kind: "away" }>, merchant: string): string {
  return access.signer
    ? `The merchant service here signs for ${shortAddress(access.signer)}, not ${shortAddress(merchant)}, so only that merchant's own service can refund these orders.`
    : "Refunds are signed with the merchant's own key, on the merchant's own machine, and this page cannot reach that service. Open the desk where the merchant service runs to refund.";
}

export type PanelView = "detail" | "refund";

interface OrderPanelProps {
  order: Order;
  /** The order as /orders/:id reports it, with every refund; null until it loads. */
  detail: ReceiptOrder | null;
  item: string;
  row: RowState | undefined;
  refusals: readonly Refusal[];
  access: RefundAccess;
  /** The desk's precision, so the panel's figures match the ledger's. */
  places?: number;
  view: PanelView;
  receiptTo: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** True inside the phone sheet, where nothing takes focus on its own (no keyboard popping up). */
  touch: boolean;
  onView: (view: PanelView) => void;
  onClose: () => void;
  onRefundAll: () => void;
  onUndo: () => void;
  onRefundPart: (amount: bigint, reason: RefundReason) => Promise<PartOutcome>;
  onUnlock: () => void;
}

export function OrderPanel(props: OrderPanelProps) {
  return props.view === "refund" && canRefund(props.order) && props.order.status !== "held" ? (
    <RefundForm {...props} />
  ) : (
    <OrderDetail {...props} />
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="mx-close" onClick={onClose} aria-label="Close the order">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function Unit({ symbol }: { symbol: string }) {
  return <span className="mx-unit">{symbol}</span>;
}

function OrderDetail({
  order,
  detail,
  item,
  row,
  refusals,
  access,
  places: deskPlaces,
  receiptTo,
  headingRef,
  onView,
  onClose,
  onRefundAll,
  onUndo,
  onUnlock,
}: OrderPanelProps) {
  const unit = assetOf(order);
  const explorer = explorerOf(order);
  const headingId = useId();
  const breakdownId = useId();
  const activityId = useId();
  const held = order.status === "held";
  const amount = BigInt(order.amount);
  const lines = adjustments(order);
  const net = contribution(order);
  const money = [amount, net, ...lines.map((line) => ("amount" in line ? line.amount : 0n))];
  const places = Math.max(deskPlaces ?? 2, decimalsFor(money));
  const events = timeline(detail ?? { ...order }, "merchant", refusals);

  return (
    <div className="mx-panel__inner">
      <div className="mx-panel__head">
        <h2 className="mx-panel__title" id={headingId} ref={headingRef} tabIndex={-1}>
          {item}
        </h2>
        <CloseButton onClose={onClose} />
      </div>
      <p className="mx-status">
        <span className={`mx-dot mx-dot--${statusTone(order.status)}`} aria-hidden="true" />
        {statusLabel(order.status)}
      </p>

      <p className={`mx-panel__amount mono${held || order.status === "pending" ? " mx-money" : ""}`}>
        {formatUsdt(order.amount)}
        <Unit symbol={unit} />
      </p>
      <p className="mx-panel__meta">
        From{" "}
        <a className="mono" href={addressUrl(order.customer, explorer)} title={order.customer} target="_blank" rel="noreferrer">
          {shortAddress(order.customer)}
        </a>
        <span aria-hidden="true"> · </span>
        <time dateTime={new Date(order.createdAt).toISOString()}>{humanDate(order.createdAt)}</time>
      </p>

      <div className="mx-panel__actions">
        <PanelRefund
          order={order}
          row={row}
          access={access}
          onRefundAll={onRefundAll}
          onUndo={onUndo}
          onPart={() => onView("refund")}
          onUnlock={onUnlock}
        />
        <Link className="mx-link" to={receiptTo}>
          Customer receipt
        </Link>
      </div>

      <section className="mx-panel__section" aria-labelledby={breakdownId}>
        <h3 className="mx-label" id={breakdownId}>
          Breakdown
        </h3>
        <dl className="mx-sum">
          <div className="mx-sum__line">
            <dt>Amount</dt>
            <dd className="mono">
              {formatFixed(amount, places)}
              <Unit symbol={unit} />
            </dd>
          </div>
          {lines.map((line) =>
            "amount" in line ? (
              <div className="mx-sum__line mx-sum__line--less" key={line.kind}>
                <dt>
                  {line.kind === "toll"
                    ? "Toll"
                    : line.kind === "refunded"
                      ? "Refunded"
                      : line.close === "cancel"
                        ? "Returned on cancel"
                        : "Returned at deadline"}
                </dt>
                <dd className="mono">
                  −{formatFixed(line.amount, places)}
                  <Unit symbol={unit} />
                </dd>
              </div>
            ) : null,
          )}
          <div className="mx-sum__line mx-sum__line--total">
            <dt>{held ? "Held until delivery" : order.status === "pending" ? "Settling" : "Net"}</dt>
            <dd className={`mono${held || order.status === "pending" ? " mx-money" : ""}`}>
              {formatFixed(held || order.status === "pending" ? amount : net, places)}
              <Unit symbol={unit} />
            </dd>
          </div>
        </dl>
      </section>

      <section className="mx-panel__section" aria-labelledby={activityId}>
        <h3 className="mx-label" id={activityId}>
          Activity
        </h3>
        <Timeline events={events} labelledBy={activityId} explorer={explorer} />
      </section>
    </div>
  );
}

interface PanelRefundProps {
  order: Order;
  row: RowState | undefined;
  access: RefundAccess;
  onRefundAll: () => void;
  onUndo: () => void;
  onPart: () => void;
  onUnlock: () => void;
}

/** The panel's refund controls, in step with the row: the same undo window, the same result. */
function PanelRefund({ order, row, access, onRefundAll, onUndo, onPart, onUnlock }: PanelRefundProps) {
  const held = order.status === "held";
  if (row?.kind === "undo") return <UndoStrip order={order} onUndo={onUndo} />;
  if (row?.kind === "sending") {
    return (
      <button type="button" className="mx-button mx-button--money" disabled>
        {held ? "Cancelling…" : "Refunding…"}
      </button>
    );
  }
  const outcome =
    row?.kind === "done" ? (
      <p className="mx-outcome" role="status">
        {row.cancelled ? "Cancelled" : "Refunded"}. {formatUsdt(row.amount)} {assetOf(order)} returned to{" "}
        <span className="mono">{shortAddress(order.customer)}</span>.
      </p>
    ) : row?.kind === "error" ? (
      <p className="mx-outcome mx-outcome--refused" role="alert">
        Refused. {refusalWords(row.message)}.
      </p>
    ) : null;
  if (!offersRefund(order, row) || access.kind === "checking") return outcome;
  if (access.kind === "away") {
    return (
      <>
        {outcome}
        <p className="mx-outcome">{awayWords(access, order.merchant)}</p>
      </>
    );
  }
  if (access.kind === "locked") {
    return (
      <>
        {outcome}
        <p className="mx-outcome">
          Refunds need the merchant token.{" "}
          <button type="button" className="mx-button mx-button--quiet" onClick={onUnlock}>
            Unlock refunds
          </button>
        </p>
      </>
    );
  }
  return (
    <>
      {outcome}
      <button type="button" className="mx-button mx-button--money" onClick={onRefundAll}>
        {refundLabel(order)} {assetOf(order)}
      </button>
      {held ? null : (
        <button type="button" className="mx-button mx-button--quiet" onClick={onPart}>
          Refund part of it
        </button>
      )}
    </>
  );
}

/** "Refunding 0.75 USDT · Undo", with the window drawn as a line that runs out. */
export function UndoStrip({
  order,
  onUndo,
  undoRef,
}: {
  order: Order;
  onUndo: () => void;
  undoRef?: RefObject<HTMLButtonElement | null>;
}) {
  const held = order.status === "held";
  return (
    <span className="mx-undo" role="status">
      <span className="mx-undo__text">
        {held ? "Cancelling" : "Refunding"} <span className="mono">{formatUsdt(order.refundable)}</span> {assetOf(order)}
      </span>
      <button
        ref={undoRef}
        type="button"
        className="mx-button mx-button--quiet"
        onClick={(event) => {
          // Inside a ledger row, a click must not also open the order.
          event.stopPropagation();
          onUndo();
        }}
      >
        Undo
      </button>
      <span className="mx-undo__bar" aria-hidden="true" style={{ animationDuration: `${UNDO_MS}ms` }} />
    </span>
  );
}

function RefundForm({ order, item, detail, headingRef, touch, onView, onClose, onRefundPart }: OrderPanelProps) {
  const headingId = useId();
  const amountId = useId();
  const errorId = useId();
  const reasonId = useId();
  const remainder = BigInt(order.refundable);
  const [amount, setAmount] = useState(() => formatUsdt(order.refundable));
  const [reason, setReason] = useState<RefundReason>("requested_by_customer");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const check = checkRefundAmount(amount, remainder);
  const error = touched && !check.ok ? check.message : null;
  const toll = BigInt((detail ?? order).fee ?? "0");
  const unit = assetOf(order);

  // A desk gets the amount field ready to edit; a phone keeps its keyboard down until asked.
  useEffect(() => {
    if (!touch) inputRef.current?.focus();
  }, [touch]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!check.ok || sending) return;
    setSending(true);
    setRefused(null);
    const outcome = await onRefundPart(check.atomic, reason);
    setSending(false);
    if (outcome.ok) onView("detail");
    else setRefused(outcome.reason);
  };

  return (
    <form className="mx-panel__inner" onSubmit={(event) => void submit(event)} noValidate>
      <div className="mx-panel__head">
        <button type="button" className="mx-button mx-button--quiet mx-back" onClick={() => onView("detail")}>
          Back to the order
        </button>
        <CloseButton onClose={onClose} />
      </div>
      <h2 className="mx-panel__title" id={headingId} ref={headingRef} tabIndex={-1}>
        Refund part of this payment
      </h2>
      <p className="mx-panel__meta">
        {item}
        <span aria-hidden="true"> · </span>
        <span className="mono">{shortAddress(order.customer)}</span>
      </p>

      <dl className="mx-sum">
        <div className="mx-sum__line mx-sum__line--total">
          <dt>Left to refund</dt>
          <dd className="mono">
            {formatUsdt(order.refundable)}
            <Unit symbol={unit} />
          </dd>
        </div>
      </dl>

      <div className="mx-field">
        <label className="mx-field__label" htmlFor={amountId}>
          Amount
        </label>
        <div className={`mx-input${error ? " mx-input--invalid" : ""}`}>
          <input
            ref={inputRef}
            id={amountId}
            className="mx-input__field mono"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            value={amount}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setRefused(null);
            }}
            onBlur={() => setTouched(true)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <span className="mx-input__unit" aria-hidden="true">
            {unit}
          </span>
        </div>
        {error ? (
          <p className="mx-field__error" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>

      <div className="mx-field">
        <label className="mx-field__label" htmlFor={reasonId}>
          Reason
        </label>
        <select
          id={reasonId}
          className="mx-select"
          value={reason}
          onChange={(event) => setReason(event.target.value as RefundReason)}
        >
          {REFUND_REASONS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <p className="mx-final">
        A refund is a new {unit} transfer from you to the customer on {networkNameOf(order)}. It settles in{" "}
        {isWhitechain(order) ? "about a second" : "seconds"} and cannot be undone.
        {toll > 0n ? ` The ${formatUsdt(toll.toString())} ${unit} toll is not returned to you.` : ""}
      </p>

      {refused ? (
        <p className="mx-outcome mx-outcome--refused" role="alert">
          Refused. {refusalWords(refused)}.
        </p>
      ) : null}

      <div className="mx-panel__actions">
        <button type="submit" className="mx-button mx-button--money" disabled={sending}>
          {sending ? "Refunding…" : check.ok ? `Refund ${formatUsdt(check.atomic.toString())} ${unit}` : "Refund"}
        </button>
      </div>
    </form>
  );
}

/**
 * Below the desk width the order opens as a modal sheet: a bottom sheet on a phone, a drawer on a
 * tablet. The native dialog traps focus, makes the page behind inert and closes on Escape.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);
  const fallbackRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      window.clearTimeout(fallbackRef.current);
      root.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  const finish = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    window.clearTimeout(fallbackRef.current);
    onClose();
  };

  const requestClose = () => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    setClosing(true);
    // If the exit animation never reports its end, the sheet still goes.
    fallbackRef.current = window.setTimeout(finish, 320);
  };

  return (
    <dialog
      ref={ref}
      className="mx-sheet"
      data-closing={closing ? "" : undefined}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        // A click on the dialog itself, outside its body, is a click on the backdrop.
        if (event.target === event.currentTarget) requestClose();
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) finish();
      }}
    >
      <div className="mx-sheet__body">{children}</div>
    </dialog>
  );
}
