import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "../../app/router.tsx";
import type { Order, OrderFilter, RelayStatus } from "./model.ts";
import {
  ORDER_FILTERS,
  addressUrl,
  canRefund,
  dateStamp,
  filterCounts,
  formatUsdt,
  formatWbt,
  formatWeiWbt,
  humanDate,
  itemLabel,
  matchesFilter,
  receivedAt,
  relativeTime,
  shortAddress,
  shortHash,
  shortHumanDate,
  statusLabel,
  statusTone,
  totals,
  txUrl,
} from "./model.ts";
import {
  RELAY_URL,
  fetchMerchant,
  fetchOfferTitle,
  fetchOrders,
  fetchOrdersCsv,
  fetchRelayStatus,
  refundOrder,
} from "./api.ts";
import { fixtureCsv, fixtureMerchant, fixtureOrders, fixtureRefundTx, fixtureStatus } from "./fixtures.ts";

const POLL_MS = 2500;
const STATUS_POLL_MS = 5000;
const HIGHLIGHT_MS = 1200;
/** One click refunds; this is the window to take it back before anything is signed. */
const UNDO_MS = 4000;

/** Where a row's refund stands. Absent means nothing was asked. */
type RowState =
  | { kind: "undo" }
  | { kind: "sending" }
  | { kind: "done"; txHash: string; amount: string; cancelled: boolean }
  | { kind: "error"; message: string };

interface DeskProps {
  fixture: boolean;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

/** "merchant_balance_low" -> "Merchant balance low" */
function words(reason: string): string {
  const cleaned = reason
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\.+$/, "");
  if (cleaned === "") return "The refund did not go through";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${window.location.origin}${url}` : url;
}

export function Desk({ fixture }: DeskProps) {
  const [orders, setOrders] = useState<Order[]>(() => (fixture ? fixtureOrders : []));
  const [merchant, setMerchant] = useState(() => (fixture ? fixtureMerchant : ""));
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(() => (fixture ? fixtureStatus : null));
  const [relayFailed, setRelayFailed] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(fixture);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const seenRef = useRef<Set<string> | null>(fixture ? new Set(fixtureOrders.map((order) => order.id)) : null);
  const timersRef = useRef<number[]>([]);
  const undoTimersRef = useRef(new Map<string, number>());
  const requestedTitlesRef = useRef(new Set<string>());
  const pollBusyRef = useRef(false);
  const mountedRef = useRef(true);

  const setRow = useCallback((id: string, state: RowState | null) => {
    setRows((current) => {
      const next = { ...current };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }, []);

  const applyOrders = useCallback((next: Order[]) => {
    const seen = seenRef.current;
    if (seen === null) {
      seenRef.current = new Set(next.map((order) => order.id));
    } else {
      const added = next.filter((order) => !seen.has(order.id)).map((order) => order.id);
      for (const id of added) seen.add(id);
      if (added.length > 0 && !reducedMotion()) {
        setNewIds((current) => new Set([...current, ...added]));
        for (const id of added) {
          const timer = window.setTimeout(() => {
            setNewIds((current) => {
              if (!current.has(id)) return current;
              const copy = new Set(current);
              copy.delete(id);
              return copy;
            });
          }, HIGHLIGHT_MS);
          timersRef.current.push(timer);
        }
      }
    }
    setOrders(next);
    setMerchant((current) => current || next[0]?.merchant || "");
    setLoaded(true);
    setServiceError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const list = await fetchOrders();
      if (mountedRef.current) applyOrders(list.orders);
    } catch (error) {
      if (mountedRef.current) setServiceError(messageOf(error));
    } finally {
      pollBusyRef.current = false;
    }
  }, [applyOrders]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    const undoTimers = undoTimersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of timers) window.clearTimeout(timer);
      for (const timer of undoTimers.values()) window.clearTimeout(timer);
    };
  }, []);

  // Orders, every 2.5 s while the tab is visible, so a payment shows up the moment it settles.
  useEffect(() => {
    if (fixture) return;
    void fetchMerchant()
      .then((me) => {
        if (mountedRef.current) setMerchant(me.address);
      })
      .catch(() => {
        // The first order carries the merchant address too.
      });
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fixture, refresh]);

  // The relayer's gas, every 5 s.
  useEffect(() => {
    if (fixture) return;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      fetchRelayStatus()
        .then((next) => {
          if (!mountedRef.current) return;
          setRelayStatus(next);
          setRelayFailed(false);
        })
        .catch(() => {
          if (mountedRef.current) setRelayFailed(true);
        });
    };
    read();
    const interval = window.setInterval(read, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [fixture]);

  // Offer titles from the hub, once per offer, for escrow orders that carry no description.
  useEffect(() => {
    if (fixture) return;
    for (const order of orders) {
      const hash = order.offerHash;
      if (!hash || order.description || requestedTitlesRef.current.has(hash)) continue;
      requestedTitlesRef.current.add(hash);
      void fetchOfferTitle(hash).then((title) => {
        if (mountedRef.current && title) setTitles((current) => ({ ...current, [hash]: title }));
      });
    }
  }, [fixture, orders]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = fixture ? fixtureCsv() : await fetchOrdersCsv();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `countersign-orders-${dateStamp(Date.now())}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(messageOf(error));
    } finally {
      setExporting(false);
    }
  };

  /** Sends the refund once the undo window has passed. */
  const sendRefund = async (order: Order) => {
    undoTimersRef.current.delete(order.id);
    setRow(order.id, { kind: "sending" });
    const cancelled = order.status === "held";

    if (fixture) {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const txHash = fixtureRefundTx(order.id);
      const amount = order.refundable;
      setOrders((current) =>
        current.map((candidate) => {
          if (candidate.id !== order.id) return candidate;
          if (cancelled) {
            return { ...candidate, refundable: "0", status: "cancelled", closeKind: "cancel", closeTx: txHash };
          }
          return {
            ...candidate,
            refunded: (BigInt(candidate.refunded) + BigInt(amount)).toString(),
            refundable: "0",
            status: "refunded",
            refundTxs: [...candidate.refundTxs, txHash],
          };
        }),
      );
      setRow(order.id, { kind: "done", txHash, amount, cancelled });
      return;
    }

    try {
      const result = await refundOrder(order.id);
      if (!mountedRef.current) return;
      setRow(
        order.id,
        result.ok
          ? { kind: "done", txHash: result.txHash, amount: result.refunded ?? order.refundable, cancelled }
          : { kind: "error", message: result.reason },
      );
    } catch (error) {
      if (mountedRef.current) setRow(order.id, { kind: "error", message: messageOf(error) });
    } finally {
      void refresh();
    }
  };

  /** One click: the refund is on its way unless the merchant takes it back within the window. */
  const startRefund = (order: Order) => {
    if (undoTimersRef.current.has(order.id)) return;
    setRow(order.id, { kind: "undo" });
    const timer = window.setTimeout(() => void sendRefund(order), UNDO_MS);
    undoTimersRef.current.set(order.id, timer);
  };

  const undoRefund = (id: string) => {
    const timer = undoTimersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    undoTimersRef.current.delete(id);
    setRow(id, null);
  };

  const sums = totals(orders);
  const counts = useMemo(() => filterCounts(orders), [orders]);
  const visible = useMemo(() => orders.filter((order) => matchesFilter(order, filter)), [orders, filter]);
  const now = Date.now();
  const receiptQuery = fixture ? "?fixture=1" : "";

  const figures = [
    { label: "Received", value: formatUsdt(sums.received) },
    { label: "Held in escrow", value: formatUsdt(sums.held) },
    { label: "Refunded", value: formatUsdt(sums.refunded) },
    { label: "Net", value: `${sums.netNegative ? "−" : ""}${formatUsdt(sums.net)}` },
  ] as const;

  return (
    <div className="mx-page">
      <header className="mx-head">
        <h1 className="mx-title">Merchant</h1>
        <p className="mx-sub">
          Whitechain Sepolia · USDT
          {merchant ? (
            <>
              {" · "}
              <a className="mono" href={addressUrl(merchant)} title={merchant}>
                {shortAddress(merchant)}
              </a>
            </>
          ) : null}
        </p>
      </header>

      <section className="mx-figures" aria-label="Totals">
        {figures.map((figure) => (
          <div className="mx-figure" key={figure.label}>
            <span className="mx-figure__label">{figure.label}</span>
            <span className="mx-figure__value num">
              {figure.value}
              <span className="mx-figure__suffix">USDT</span>
            </span>
          </div>
        ))}
      </section>

      <section className="mx-gas" aria-label="Gas">
        <span className="mx-gas__text">Gas is paid by the countersign relayer. Customers never hold WBT.</span>
        {relayStatus ? (
          <span className="mx-gas__facts num">
            <a className="mono" href={addressUrl(relayStatus.address)} title={relayStatus.address}>
              {shortAddress(relayStatus.address)}
            </a>
            <span aria-hidden="true">·</span>
            <span>{formatWbt(relayStatus.balanceWbt)} WBT left</span>
            <span aria-hidden="true">·</span>
            <span>
              {formatWeiWbt(relayStatus.ceiling.usedWei)} of {formatWeiWbt(relayStatus.ceiling.capWei)} WBT this hour
            </span>
          </span>
        ) : relayFailed ? (
          <span className="mx-gas__facts">Relayer unreachable.</span>
        ) : null}
      </section>

      <section className="mx-orders" aria-labelledby="mx-orders-heading">
        <div className="mx-toolbar">
          <h2 className="mx-toolbar__title" id="mx-orders-heading">
            Orders
          </h2>
          <div className="mx-filters" role="group" aria-label="Show orders">
            {ORDER_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className="mx-filter"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="mx-filter__count num">{counts[key]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mx-button mx-toolbar__export"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Export for accountant"}
          </button>
        </div>
        {exportError ? <p className="mx-note">{exportError}</p> : null}
        {serviceError ? (
          <p className="mx-note" role="status">
            {serviceError}
          </p>
        ) : null}

        {loaded && orders.length === 0 && !serviceError ? (
          <FirstPayment merchant={merchant} />
        ) : visible.length === 0 && orders.length > 0 ? (
          <div className="mx-empty">
            <p>No payments match this filter.</p>
            <button type="button" className="mx-button" onClick={() => setFilter("all")}>
              Show all orders
            </button>
          </div>
        ) : orders.length > 0 ? (
          <table className="mx-table">
            <caption className="sr-only">Orders received through countersign, newest first.</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Item</th>
                <th scope="col">Customer</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col" className="mx-num">
                  Amount
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const row = rows[order.id];
                const item = itemLabel(order, order.offerHash ? titles[order.offerHash] : null);
                const received = receivedAt(order);
                const held = order.status === "held";
                return (
                  <Fragment key={order.id}>
                    <tr className={`mx-row${newIds.has(order.id) ? " mx-row--new" : ""}${row ? " mx-row--busy" : ""}`}>
                      <td className="mx-cell--date">
                        <time dateTime={new Date(order.createdAt).toISOString()} title={humanDate(order.createdAt)}>
                          {relativeTime(order.createdAt, now)}
                        </time>
                      </td>
                      <td className="mx-cell--item">
                        <span className="mx-item" title={item}>
                          {item}
                        </span>
                      </td>
                      <td className="mx-cell--customer">
                        <a className="mono" href={addressUrl(order.customer)} title={order.customer}>
                          {shortAddress(order.customer)}
                        </a>
                      </td>
                      <td className="mx-cell--status">
                        <span className={`mx-pill mx-pill--${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                      </td>
                      <td className="mx-cell--received num">
                        <span className="mx-mobile-label">Received </span>
                        {received !== null ? (
                          <time dateTime={new Date(received).toISOString()} title={humanDate(received)}>
                            {shortHumanDate(received)}
                          </time>
                        ) : (
                          <span className="mx-muted" title={held ? "Counts once the escrow releases." : undefined}>
                            {held ? "On release" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="mx-cell--amount mx-num">
                        <span className="mx-amount num">{formatUsdt(order.amount)}</span>
                        <span className="mx-amount__unit">USDT</span>
                      </td>
                      <td className="mx-cell--actions">
                        <RowActions
                          order={order}
                          row={row}
                          receiptTo={`/merchant/receipt/${order.id}${receiptQuery}`}
                          onRefund={() => startRefund(order)}
                          onUndo={() => undoRefund(order.id)}
                        />
                      </td>
                    </tr>
                    {row?.kind === "done" || row?.kind === "error" ? (
                      <tr className="mx-result-row">
                        <td colSpan={7}>
                          {row.kind === "done" ? (
                            <p className="mx-result" role="status">
                              {row.cancelled ? "Cancelled" : "Refunded"}. {formatUsdt(row.amount)} USDT returned to{" "}
                              {shortAddress(order.customer)}.{" "}
                              <a className="mono" href={txUrl(row.txHash)} title={row.txHash}>
                                {shortHash(row.txHash)}
                              </a>
                            </p>
                          ) : (
                            <p className="mx-result mx-result--error" role="alert">
                              Refused. {words(row.message)}.
                            </p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}

interface RowActionsProps {
  order: Order;
  row: RowState | undefined;
  receiptTo: string;
  onRefund: () => void;
  onUndo: () => void;
}

function RowActions({ order, row, receiptTo, onRefund, onUndo }: RowActionsProps) {
  const amount = formatUsdt(order.refundable);
  const held = order.status === "held";
  const undoRef = useRef<HTMLButtonElement>(null);

  // Keyboard users land on Undo the moment it exists, so Escape-free undo is one keypress away.
  useEffect(() => {
    if (row?.kind === "undo") undoRef.current?.focus();
  }, [row?.kind]);

  let action = null;
  if (row?.kind === "undo") {
    action = (
      <span className="mx-undo" role="status">
        <span className="mx-undo__text num">
          {held ? "Cancelling" : "Refunding"} {amount}
        </span>
        <button ref={undoRef} type="button" className="mx-button mx-button--quiet" onClick={onUndo}>
          Undo
        </button>
        <span className="mx-undo__bar" aria-hidden="true" />
      </span>
    );
  } else if (row?.kind === "sending") {
    action = (
      <button type="button" className="mx-button mx-action" disabled>
        {held ? "Cancelling…" : "Refunding…"}
      </button>
    );
  } else if (row?.kind === "done") {
    action = <span className="mx-done">{row.cancelled ? "Cancelled" : "Refunded"}</span>;
  } else if (canRefund(order)) {
    action = (
      <button
        type="button"
        className="mx-button mx-action"
        onClick={onRefund}
        aria-label={held ? `Cancel and refund ${amount} USDT` : `Refund ${amount} USDT`}
      >
        Refund
      </button>
    );
  }

  return (
    <span className="mx-actions">
      <Link className="mx-link" to={receiptTo}>
        View receipt
      </Link>
      {action}
    </span>
  );
}

/** A merchant with no payments yet gets the next step, not a picture. */
function FirstPayment({ merchant }: { merchant: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `app.get("/report",
  whitechainPaywall({ price: "0.05", payTo: "${merchant || "0xYourAddress"}", facilitator: "${absoluteUrl(RELAY_URL)}" }),
  (c) => c.json(report()));`;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mx-empty mx-empty--first">
      <p>No payments yet.</p>
      <p className="mx-muted">Add the paywall to your API in one line:</p>
      <div className="mx-snippet">
        <pre className="mono">
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          className="mx-button mx-button--quiet mx-snippet__copy"
          onClick={() => {
            void navigator.clipboard
              .writeText(snippet)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
