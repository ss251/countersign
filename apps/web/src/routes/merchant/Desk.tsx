import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Order, RelayStatus } from "./model.ts";
import {
  addressUrl,
  canRefund,
  dateStamp,
  formatUsdt,
  formatWbt,
  formatWeiWbt,
  relativeTime,
  refundLabel,
  shortAddress,
  shortHash,
  statusLabel,
  statusTone,
  totals,
  txUrl,
} from "./model.ts";
import {
  fetchMerchant,
  fetchOrders,
  fetchOrdersCsv,
  fetchRelayStatus,
  refundOrder,
} from "./api.ts";
import { fixtureCsv, fixtureMerchant, fixtureOrders, fixtureStatus } from "./fixtures.ts";

const POLL_MS = 2500;
const HIGHLIGHT_MS = 1200;

type RefundRow =
  | { kind: "ok"; txHash: string; amount: string }
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

function words(reason: string): string {
  const cleaned = reason
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\.+$/, "");
  if (cleaned === "") return "The refund did not go through";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function Desk({ fixture }: DeskProps) {
  const [orders, setOrders] = useState<Order[]>(() => (fixture ? fixtureOrders : []));
  const [merchant, setMerchant] = useState(() => (fixture ? fixtureMerchant : ""));
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(() =>
    fixture ? fixtureStatus : null,
  );
  const [relayFailed, setRelayFailed] = useState(false);
  const [loaded, setLoaded] = useState(fixture);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refunding, setRefunding] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, RefundRow>>({});
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const seenRef = useRef<Set<string> | null>(
    fixture ? new Set(fixtureOrders.map((order) => order.id)) : null,
  );
  const timersRef = useRef<number[]>([]);
  const pollBusyRef = useRef(false);

  const applyOrders = useCallback((next: Order[]) => {
    const seen = seenRef.current;
    if (seen === null) {
      seenRef.current = new Set(next.map((order) => order.id));
    } else {
      const added: string[] = [];
      for (const order of next) {
        if (!seen.has(order.id)) {
          seen.add(order.id);
          added.push(order.id);
        }
      }
      if (added.length > 0 && !reducedMotion()) {
        setNewIds((current) => {
          const copy = new Set(current);
          for (const id of added) copy.add(id);
          return copy;
        });
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

  useEffect(() => {
    if (fixture) return;
    let cancelled = false;

    const refresh = async () => {
      if (pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const list = await fetchOrders();
        if (!cancelled) applyOrders(list.orders);
      } catch (error) {
        if (!cancelled) setServiceError(messageOf(error));
      } finally {
        pollBusyRef.current = false;
      }
    };

    void (async () => {
      try {
        const me = await fetchMerchant();
        if (!cancelled) setMerchant(me.address);
      } catch {
        // The first order carries the merchant address too.
      }
    })();
    void refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyOrders, fixture]);

  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    fetchRelayStatus()
      .then((next) => {
        if (!cancelled) setRelayStatus(next);
      })
      .catch(() => {
        if (!cancelled) setRelayFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fixture]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      timersRef.current = [];
    };
  }, []);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = fixture ? fixtureCsv() : await fetchOrdersCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
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

  const handleRefund = async (order: Order) => {
    if (refunding[order.id]) return;
    setRefunding((current) => ({ ...current, [order.id]: true }));
    setResults((current) => {
      if (!(order.id in current)) return current;
      const copy = { ...current };
      delete copy[order.id];
      return copy;
    });

    if (fixture) {
      const amount = order.refundable;
      const txHash = "0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5";
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      setOrders((current) =>
        current.map((candidate) =>
          candidate.id === order.id
            ? {
                ...candidate,
                refunded: amount,
                refundable: "0",
                status: "refunded",
                refundTxs: [...candidate.refundTxs, txHash],
              }
            : candidate,
        ),
      );
      setResults((current) => ({ ...current, [order.id]: { kind: "ok", txHash, amount } }));
      setRefunding((current) => {
        const copy = { ...current };
        delete copy[order.id];
        return copy;
      });
      return;
    }

    try {
      const result = await refundOrder(order.id);
      if (result.ok) {
        setResults((current) => ({
          ...current,
          [order.id]: { kind: "ok", txHash: result.txHash, amount: result.refunded },
        }));
      } else {
        setResults((current) => ({
          ...current,
          [order.id]: { kind: "error", message: result.reason },
        }));
      }
    } catch (error) {
      setResults((current) => ({
        ...current,
        [order.id]: { kind: "error", message: messageOf(error) },
      }));
    } finally {
      setRefunding((current) => {
        const copy = { ...current };
        delete copy[order.id];
        return copy;
      });
      try {
        const list = await fetchOrders();
        applyOrders(list.orders);
      } catch (error) {
        setServiceError(messageOf(error));
      }
    }
  };

  const sums = totals(orders);
  const figures = [
    { label: "Received", value: formatUsdt(sums.received), suffix: "USDT", money: true },
    { label: "Refunded", value: formatUsdt(sums.refunded), suffix: "USDT", money: false },
    { label: "Net", value: formatUsdt(sums.net), suffix: "USDT", money: true },
    { label: "Orders", value: String(sums.count), suffix: null, money: false },
  ] as const;

  const now = Date.now();

  return (
    <div className="mx-page">
      <header className="mx-head">
        <div className="mx-head__id">
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
          {exportError ? <p className="mx-note">{exportError}</p> : null}
        </div>
        <button
          type="button"
          className="mx-export"
          onClick={() => void handleExport()}
          disabled={exporting}
          aria-busy={exporting || undefined}
        >
          Export for accountant
        </button>
      </header>

      <section className="mx-figures" aria-label="Totals">
        {figures.map((figure) => (
          <div className="mx-figure" key={figure.label}>
            <span className="mx-figure__label">{figure.label}</span>
            <span className={`mx-figure__value num${figure.money ? " mx-figure__value--money" : ""}`}>
              {figure.value}
              {figure.suffix ? <span className="mx-figure__suffix">{figure.suffix}</span> : null}
            </span>
          </div>
        ))}
      </section>

      <section className="mx-gas" aria-label="Gas">
        <span className="mx-gas__text">
          Gas is paid by the countersign relayer. Customers never hold WBT.
        </span>
        {relayStatus ? (
          <span className="mx-gas__facts num">
            <a className="mono" href={addressUrl(relayStatus.address)} title={relayStatus.address}>
              {shortAddress(relayStatus.address)}
            </a>
            <span aria-hidden="true" className="mx-gas__dot">
              ·
            </span>
            <span>{formatWbt(relayStatus.balanceWbt)} WBT left</span>
            <span aria-hidden="true" className="mx-gas__dot">
              ·
            </span>
            <span>
              {formatWeiWbt(relayStatus.ceiling.usedWei)}/{formatWeiWbt(relayStatus.ceiling.capWei)}{" "}
              WBT this hour
            </span>
          </span>
        ) : relayFailed ? (
          <span className="mx-gas__facts">Relayer unreachable.</span>
        ) : null}
      </section>

      {serviceError ? (
        <p className="mx-note" role="status">
          {serviceError}
        </p>
      ) : null}

      {serviceError && orders.length === 0 ? null : (
        <section className="mx-orders" aria-label="Orders">
          <div className="mx-table-wrap">
            <table className="mx-table">
              <caption className="sr-only">Orders received through countersign.</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Item</th>
                  <th scope="col" className="mx-align-right">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Proof</th>
                  <th scope="col" className="mx-align-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const tone = statusTone(order.status);
                  const result = results[order.id];
                  const lastRefund =
                    order.refundTxs.length > 0 ? order.refundTxs[order.refundTxs.length - 1] : null;
                  const secondary = order.closeTx ?? lastRefund ?? null;
                  const item = order.resource?.trim() || `Order ${shortHash(order.id)}`;
                  return (
                    <Fragment key={order.id}>
                      <tr className={`mx-row${newIds.has(order.id) ? " mx-row--new" : ""}`}>
                        <td>
                          <time
                            dateTime={new Date(order.createdAt).toISOString()}
                            title={new Date(order.createdAt).toISOString()}
                          >
                            {relativeTime(order.createdAt, now)}
                          </time>
                        </td>
                        <td>
                          <a className="mono" href={addressUrl(order.customer)} title={order.customer}>
                            {shortAddress(order.customer)}
                          </a>
                        </td>
                        <td>
                          <span className="mx-item" title={item}>
                            {item}
                          </span>
                        </td>
                        <td
                          className={`mx-align-right num${
                            tone === "money" ? " mx-amount--money" : ""
                          }`}
                        >
                          {formatUsdt(order.amount)} USDT
                        </td>
                        <td>
                          <span className={`mx-pill mx-pill--${tone}`}>{statusLabel(order.status)}</span>
                        </td>
                        <td>
                          <span className="mx-proof">
                            <a
                              className="mono"
                              href={txUrl(order.settleTx)}
                              title={order.settleTx}
                              aria-label={`Settlement transaction ${order.settleTx}`}
                            >
                              {shortHash(order.settleTx)}
                            </a>
                            {secondary ? (
                              <a
                                className="mono mx-proof__second"
                                href={txUrl(secondary)}
                                title={secondary}
                                aria-label={`Close or refund transaction ${secondary}`}
                              >
                                {shortHash(secondary)}
                              </a>
                            ) : null}
                          </span>
                        </td>
                        <td className="mx-align-right">
                          {result?.kind === "ok" ? (
                            <span className="mx-refunded">
                              Refunded{" "}
                              <a
                                className="mono"
                                href={txUrl(result.txHash)}
                                title={result.txHash}
                                aria-label={`Refund transaction ${result.txHash}`}
                              >
                                {shortHash(result.txHash)}
                              </a>
                            </span>
                          ) : refunding[order.id] ? (
                            <button type="button" className="mx-action" disabled>
                              Refunding…
                            </button>
                          ) : canRefund(order) ? (
                            <button
                              type="button"
                              className="mx-action"
                              onClick={() => void handleRefund(order)}
                            >
                              {refundLabel(order)}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {result ? (
                        <tr className="mx-result-row">
                          <td colSpan={7}>
                            {result.kind === "ok" ? (
                              <p className="mx-result mx-result--ok" role="status">
                                Refunded. {formatUsdt(result.amount)} USDT returned to{" "}
                                {shortAddress(order.customer)}.{" "}
                                <a
                                  href={txUrl(result.txHash)}
                                  title={result.txHash}
                                  aria-label={`Refund transaction ${result.txHash}`}
                                >
                                  {shortHash(result.txHash)}
                                </a>
                              </p>
                            ) : (
                              <p className="mx-result mx-result--error" role="alert">
                                Refused. {words(result.message)}.
                              </p>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {loaded && !serviceError && orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="mx-empty">
                      No orders yet. A payment shows up here the second it settles.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
