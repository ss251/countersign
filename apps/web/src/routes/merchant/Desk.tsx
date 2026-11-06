import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Equation, Order, OrderFilter, ReceiptOrder, RefundReason, RefundRecord, Refusal, RelayStatus } from "./model.ts";
import {
  ORDER_FILTERS,
  addressUrl,
  adjustments,
  canRefund,
  dateStamp,
  decimalsFor,
  equation,
  filterCounts,
  formatFixed,
  formatUsdt,
  formatWbt,
  formatWeiWbt,
  humanDate,
  itemLabel,
  ledger,
  matchesFilter,
  refundLabel,
  refusalWords,
  shortAddress,
  shortHash,
  shortHumanDate,
  statusLabel,
  statusTone,
  txUrl,
} from "./model.ts";
import {
  RELAY_URL,
  canSignRefunds,
  fetchOfferTitle,
  fetchOrders,
  fetchOrdersCsv,
  fetchRelayOrder,
  fetchRelayStatus,
  refundOrder,
  resolveMerchant,
  unlockRefunds,
} from "./api.ts";
import { fixtureCsv, fixtureDetail, fixtureMerchant, fixtureOrders, fixtureRefundTx, fixtureStatus } from "./fixtures.ts";
import { OrderPanel, Sheet, UNDO_MS, UndoStrip, type PanelView, type PartOutcome, type RowState } from "./Panel.tsx";

const POLL_MS = 2500;
const STATUS_POLL_MS = 5000;
const HIGHLIGHT_MS = 1200;
/** From this width the order opens beside the ledger; below it, as a sheet over it. */
const SPLIT_QUERY = "(min-width: 1100px)";

interface DeskProps {
  fixture: boolean;
  /** ?merchant=0x…: whose ledger to read. */
  merchantQuery: string | null;
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed.";
}

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${window.location.origin}${url}` : url;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function Unit() {
  return <span className="mx-unit">USDT</span>;
}

export function Desk({ fixture, merchantQuery }: DeskProps) {
  const [orders, setOrders] = useState<Order[]>(() => (fixture ? fixtureOrders : []));
  const [merchant, setMerchant] = useState(() => (fixture ? fixtureMerchant : ""));
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(() => (fixture ? fixtureStatus : null));
  const [relayFailed, setRelayFailed] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(fixture);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [refusals, setRefusals] = useState<Record<string, Refusal[]>>({});
  const [added, setAdded] = useState<Record<string, RefundRecord[]>>({});
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("detail");
  const [detail, setDetail] = useState<ReceiptOrder | null>(null);
  const [canSign, setCanSign] = useState(() => fixture || canSignRefunds());
  const [unlockOpen, setUnlockOpen] = useState(false);

  const split = useMedia(SPLIT_QUERY);
  const touch = useMedia("(hover: none)");
  const seenRef = useRef<Set<string> | null>(fixture ? new Set(fixtureOrders.map((order) => order.id)) : null);
  const timersRef = useRef<number[]>([]);
  const undoTimersRef = useRef(new Map<string, number>());
  const requestedTitlesRef = useRef(new Set<string>());
  const openRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const unlockInputRef = useRef<HTMLInputElement | null>(null);
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

  const addRefusal = useCallback((id: string, reason: string) => {
    setRefusals((current) => ({ ...current, [id]: [...(current[id] ?? []), { at: Date.now(), reason }] }));
  }, []);

  const applyOrders = useCallback((next: Order[]) => {
    const seen = seenRef.current;
    if (seen === null) {
      seenRef.current = new Set(next.map((order) => order.id));
    } else {
      const fresh = next.filter((order) => !seen.has(order.id)).map((order) => order.id);
      for (const id of fresh) seen.add(id);
      if (fresh.length > 0 && !reducedMotion()) {
        setNewIds((current) => new Set([...current, ...fresh]));
        for (const id of fresh) {
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
    setLoaded(true);
    setServiceError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (fixture || !merchant || pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const list = await fetchOrders(merchant);
      if (mountedRef.current) applyOrders(list);
    } catch (error) {
      if (mountedRef.current) setServiceError(messageOf(error));
    } finally {
      pollBusyRef.current = false;
    }
  }, [applyOrders, fixture, merchant]);

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

  // Whose desk: ?merchant=, the hosted build's address, or the local merchant service.
  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    resolveMerchant(merchantQuery)
      .then((address) => {
        if (cancelled) return;
        setMerchant(address);
        setMerchantError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMerchantError(messageOf(error));
      });
    return () => {
      cancelled = true;
    };
  }, [fixture, merchantQuery]);

  // Orders, every 2.5 s while the tab is visible, so a payment shows up the moment it settles.
  useEffect(() => {
    if (fixture || !merchant) return;
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
  }, [fixture, merchant, refresh]);

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

  const selected = selectedId ? (orders.find((order) => order.id === selectedId) ?? null) : null;
  // The open order's full record, read again whenever the list says it changed.
  const version = selected
    ? `${selected.id}|${selected.status}|${selected.refunded}|${selected.refundTxs.length}|${selected.closeTx ?? ""}`
    : "";
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    if (fixture) {
      setDetail(fixtureDetail(selected, added[selected.id] ?? []));
      return;
    }
    let cancelled = false;
    fetchRelayOrder(selected.id)
      .then((record) => {
        if (!cancelled) setDetail(record);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
    // `version` stands for `selected`: a new poll result with the same facts does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, fixture, added]);

  const openOrder = (id: string) => {
    setSelectedId(id);
    setView("detail");
  };

  const closePanel = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    setView("detail");
    if (id) window.requestAnimationFrame(() => openRefs.current.get(id)?.focus());
  }, [selectedId]);

  // Beside the ledger the panel is not modal: it takes focus when it opens or changes view, and
  // Escape closes it. The sheet gets both from the native dialog.
  useEffect(() => {
    if (!selectedId || !split) return;
    if (view === "detail" || touch) headingRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, view, split, touch, closePanel]);

  const openUnlock = () => {
    setUnlockOpen(true);
    if (!split) closePanel();
    window.requestAnimationFrame(() => unlockInputRef.current?.focus());
  };

  const handleExport = async () => {
    if (exporting || (!fixture && !merchant)) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = fixture ? fixtureCsv() : await fetchOrdersCsv(merchant);
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

  /** The fixture desk's stand-in for the chain: the same changes the relay would report. */
  const simulateRefund = (order: Order, amount: bigint, reason: RefundReason | null, txHash: string) => {
    const cancelled = order.status === "held";
    setOrders((current) =>
      current.map((candidate) => {
        if (candidate.id !== order.id) return candidate;
        if (cancelled) {
          return {
            ...candidate,
            refundable: "0",
            status: "cancelled",
            closeKind: "cancel",
            closeTx: txHash,
            closedAt: Date.now(),
            closeReason: reason,
          };
        }
        const refunded = BigInt(candidate.refunded) + amount;
        const refundable = BigInt(candidate.refundable) - amount;
        return {
          ...candidate,
          refunded: refunded.toString(),
          refundable: refundable.toString(),
          status: refundable > 0n ? "partially_refunded" : "refunded",
          refundTxs: [...candidate.refundTxs, txHash],
        };
      }),
    );
    if (!cancelled) {
      setAdded((current) => ({
        ...current,
        [order.id]: [
          ...(current[order.id] ?? []),
          { amount: amount.toString(), txHash, status: "confirmed", reason, at: Date.now() },
        ],
      }));
    }
  };

  /** Sends the whole remainder once the undo window has passed. */
  const sendRefund = async (order: Order) => {
    undoTimersRef.current.delete(order.id);
    setRow(order.id, { kind: "sending" });
    const cancelled = order.status === "held";

    if (fixture) {
      await wait(700);
      const txHash = fixtureRefundTx(order.id, added[order.id]?.length ?? 0);
      simulateRefund(order, BigInt(order.refundable), null, txHash);
      setRow(order.id, { kind: "done", txHash, amount: order.refundable, cancelled });
      return;
    }

    try {
      const result = await refundOrder(order.id);
      if (!mountedRef.current) return;
      if (result.ok) {
        setRow(order.id, { kind: "done", txHash: result.txHash, amount: result.refunded ?? order.refundable, cancelled });
      } else {
        setRow(order.id, { kind: "error", message: result.reason });
        addRefusal(order.id, result.reason);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setRow(order.id, { kind: "error", message: messageOf(error) });
      addRefusal(order.id, messageOf(error));
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

  /** A partial refund from the panel. Deliberate already (two steps), so it sends at once. */
  const refundPart = async (order: Order, amount: bigint, reason: RefundReason): Promise<PartOutcome> => {
    if (fixture) {
      await wait(700);
      const txHash = fixtureRefundTx(order.id, (added[order.id]?.length ?? 0) + 1);
      simulateRefund(order, amount, reason, txHash);
      setRow(order.id, { kind: "done", txHash, amount: amount.toString(), cancelled: false });
      return { ok: true };
    }
    try {
      const result = await refundOrder(order.id, { amount, reason });
      if (!mountedRef.current) return { ok: true };
      if (!result.ok) {
        addRefusal(order.id, result.reason);
        return { ok: false, reason: result.reason };
      }
      setRow(order.id, { kind: "done", txHash: result.txHash, amount: result.refunded ?? amount.toString(), cancelled: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: messageOf(error) };
    } finally {
      void refresh();
    }
  };

  const sums = useMemo(() => equation(orders), [orders]);
  const counts = useMemo(() => filterCounts(orders), [orders]);
  const book = useMemo(() => ledger(orders), [orders]);
  const visible = useMemo(() => book.filter((entry) => matchesFilter(entry.order, filter)), [book, filter]);
  const amountPlaces = useMemo(() => decimalsFor(orders.map((order) => BigInt(order.amount))), [orders]);
  const balancePlaces = useMemo(() => decimalsFor(book.map((entry) => entry.balance)), [book]);
  const receiptQuery = fixture ? "?fixture=1" : "";
  const titleOf = (order: Order) => itemLabel(order, order.offerHash ? titles[order.offerHash] : null);
  const panelOpen = selected !== null;

  const panel = selected ? (
    <OrderPanel
      order={selected}
      detail={detail && detail.id === selected.id ? detail : null}
      item={titleOf(selected)}
      row={rows[selected.id]}
      refusals={refusals[selected.id] ?? []}
      canSign={canSign}
      view={view}
      receiptTo={`/merchant/receipt/${selected.id}${receiptQuery}`}
      headingRef={headingRef}
      touch={touch}
      onView={setView}
      onClose={closePanel}
      onRefundAll={() => startRefund(selected)}
      onUndo={() => undoRefund(selected.id)}
      onRefundPart={(amount, reason) => refundPart(selected, amount, reason)}
      onUnlock={openUnlock}
    />
  ) : null;

  return (
    <div className="mx-page">
      <header className="mx-head">
        <div className="mx-head__id">
          <h1 className="mx-title">Merchant</h1>
          <p className="mx-sub">
            Whitechain Sepolia · USDT
            {merchant ? (
              <>
                <span aria-hidden="true"> · </span>
                <a className="mono" href={addressUrl(merchant)} title={merchant} target="_blank" rel="noreferrer">
                  {shortAddress(merchant)}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <GasLine status={relayStatus} failed={relayFailed} />
      </header>

      <EquationBand sums={sums} />

      <div className={`mx-desk${panelOpen && split ? " mx-desk--split" : ""}`}>
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
            <div className="mx-toolbar__end">
              {!canSign && !unlockOpen ? (
                <button type="button" className="mx-button mx-button--quiet" onClick={openUnlock}>
                  Unlock refunds
                </button>
              ) : null}
              <button
                type="button"
                className="mx-button"
                onClick={() => void handleExport()}
                disabled={exporting || (!fixture && !merchant)}
              >
                {exporting ? "Exporting…" : "Export for accountant"}
              </button>
            </div>
          </div>

          {unlockOpen && !canSign ? (
            <UnlockForm
              inputRef={unlockInputRef}
              onUnlocked={() => {
                setCanSign(true);
                setUnlockOpen(false);
              }}
              onCancel={() => setUnlockOpen(false)}
            />
          ) : null}
          {exportError ? <p className="mx-note">{exportError}</p> : null}
          {serviceError ? (
            <p className="mx-note" role="status">
              {serviceError}
            </p>
          ) : null}

          {merchantError ? (
            <div className="mx-empty">
              <p>{merchantError}</p>
            </div>
          ) : loaded && orders.length === 0 && !serviceError ? (
            <FirstPayment merchant={merchant} />
          ) : visible.length === 0 && orders.length > 0 ? (
            <div className="mx-empty">
              <p>No orders match this filter.</p>
              <button type="button" className="mx-button" onClick={() => setFilter("all")}>
                Show all orders
              </button>
            </div>
          ) : orders.length > 0 ? (
            <table className="mx-table">
              <caption className="sr-only">
                Orders, newest first. Balance is the running total once each order is counted, held money included.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="mx-col-date">
                    Date
                  </th>
                  <th scope="col" className="mx-col-item">
                    Item
                  </th>
                  <th scope="col" className="mx-col-customer">
                    Customer
                  </th>
                  <th scope="col" className="mx-col-status">
                    Status
                  </th>
                  <th scope="col" className="mx-col-amount mx-num">
                    Amount
                  </th>
                  <th scope="col" className="mx-col-balance mx-num">
                    Balance
                  </th>
                  <th scope="col" className="mx-col-actions">
                    <span className="sr-only">Refund</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ order, balance }) => {
                  const row = rows[order.id];
                  const item = titleOf(order);
                  const isOpen = order.id === selectedId;
                  const inFlight = order.status === "held" || order.status === "pending";
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`mx-row${newIds.has(order.id) ? " mx-row--new" : ""}${isOpen ? " mx-row--open" : ""}`}
                        aria-current={isOpen ? "true" : undefined}
                        onClick={() => openOrder(order.id)}
                      >
                        <td className="mx-col-date num">
                          <time dateTime={new Date(order.createdAt).toISOString()} title={humanDate(order.createdAt)}>
                            {shortHumanDate(order.createdAt)}
                          </time>
                        </td>
                        <td className="mx-col-item">
                          <button
                            type="button"
                            className="mx-open"
                            ref={(element) => {
                              if (element) openRefs.current.set(order.id, element);
                              else openRefs.current.delete(order.id);
                            }}
                            aria-haspopup={split ? undefined : "dialog"}
                            onClick={(event) => {
                              event.stopPropagation();
                              openOrder(order.id);
                            }}
                          >
                            {item}
                          </button>
                        </td>
                        <td className="mx-col-customer mono" title={order.customer}>
                          {shortAddress(order.customer)}
                        </td>
                        <td className="mx-col-status">
                          <span className="mx-status">
                            <span className={`mx-dot mx-dot--${statusTone(order.status)}`} aria-hidden="true" />
                            {statusLabel(order.status)}
                          </span>
                        </td>
                        <td className="mx-col-amount mx-num">
                          <span className={`mono mx-amount${inFlight ? " mx-money" : ""}`}>
                            {formatFixed(BigInt(order.amount), amountPlaces)}
                            <Unit />
                          </span>
                          <Adjustments order={order} />
                        </td>
                        <td className="mx-col-balance mx-num">
                          <span className="mono">
                            {formatFixed(balance, balancePlaces)}
                            <Unit />
                          </span>
                        </td>
                        <td className="mx-col-actions">
                          <RowAction
                            order={order}
                            row={row}
                            canSign={canSign}
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
                                <span className="mono">{shortAddress(order.customer)}</span>.{" "}
                                <a
                                  className="mono mx-tx"
                                  href={txUrl(row.txHash)}
                                  title={row.txHash}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {shortHash(row.txHash)}
                                </a>
                              </p>
                            ) : (
                              <p className="mx-result mx-result--refused" role="alert">
                                Refused. {refusalWords(row.message)}.
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

        {panel && split ? (
          <aside className="mx-panel" aria-label="Order">
            {panel}
          </aside>
        ) : null}
      </div>

      {panel && !split ? <Sheet onClose={closePanel}>{panel}</Sheet> : null}
    </div>
  );
}

/** Released + held = total, then − refunded − toll = net, ruled like the top of a statement. */
function EquationBand({ sums }: { sums: Equation }) {
  const places = decimalsFor([sums.released, sums.held, sums.total, sums.refunded, sums.toll, sums.net]);
  const terms = [
    { label: "Released", value: sums.released, op: null, tone: "" },
    { label: "Held", value: sums.held, op: "+", tone: " mx-money" },
    { label: "Total", value: sums.total, op: "=", tone: "" },
    { label: "Refunded", value: sums.refunded, op: "−", tone: "" },
    { label: "Toll", value: sums.toll, op: "−", tone: "" },
    { label: "Net", value: sums.net, op: "=", tone: " mx-eq__term--net" },
  ] as const;
  return (
    <section className="mx-eq" aria-label="Balance">
      <dl className="mx-eq__terms">
        {terms.map((term) => (
          <div
            className={`mx-eq__term${term.op === "=" ? " mx-eq__term--sum" : ""}${term.label === "Net" ? " mx-eq__term--net" : ""}`}
            data-op={term.op ?? undefined}
            key={term.label}
          >
            <dt className="mx-label">{term.label}</dt>
            <dd className={`mx-eq__value mono${term.tone}`}>
              {formatFixed(term.value, places)}
              <Unit />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function GasLine({ status, failed }: { status: RelayStatus | null; failed: boolean }) {
  if (!status) {
    return failed ? <p className="mx-gas">Customers pay no gas. The relayer is unreachable.</p> : null;
  }
  return (
    <p className="mx-gas">
      <span>Customers pay no gas.</span>{" "}
      <span className="mx-gas__facts">
        Relayer{" "}
        <a className="mono" href={addressUrl(status.address)} title={status.address} target="_blank" rel="noreferrer">
          {shortAddress(status.address)}
        </a>
        <span aria-hidden="true"> · </span>
        <span className="num">{formatWbt(status.balanceWbt)} WBT left</span>
        <span aria-hidden="true"> · </span>
        <span className="num">
          {formatWeiWbt(status.ceiling.usedWei)} of {formatWeiWbt(status.ceiling.capWei)} WBT this hour
        </span>
      </span>
    </p>
  );
}

/** Why the balance moved by less than the amount: the toll, a refund, a cancel; or that it is still in flight. */
function Adjustments({ order }: { order: Order }) {
  const lines = adjustments(order);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line) => (
        <span className="mx-adjust" key={line.kind}>
          {line.kind === "held"
            ? "Releases on delivery"
            : line.kind === "settling"
              ? "Settling"
              : `−${formatUsdt(line.amount.toString())} ${
                  line.kind === "toll"
                    ? "toll"
                    : line.kind === "refunded"
                      ? "refunded"
                      : line.close === "cancel"
                        ? "returned on cancel"
                        : "returned at deadline"
                }`}
        </span>
      ))}
    </>
  );
}

interface RowActionProps {
  order: Order;
  row: RowState | undefined;
  canSign: boolean;
  onRefund: () => void;
  onUndo: () => void;
}

function RowAction({ order, row, canSign, onRefund, onUndo }: RowActionProps) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const startedHere = useRef(false);
  const held = order.status === "held";

  // A keyboard user who refunds from the row lands on Undo, one keypress from taking it back.
  useEffect(() => {
    if (row?.kind === "undo" && startedHere.current) undoRef.current?.focus();
    if (row?.kind !== "undo") startedHere.current = false;
  }, [row?.kind]);

  if (row?.kind === "undo") return <UndoStrip order={order} onUndo={onUndo} undoRef={undoRef} />;
  if (row?.kind === "sending") return <span className="mx-quiet">{held ? "Cancelling…" : "Refunding…"}</span>;
  if (row?.kind === "done") return <span className="mx-quiet">{row.cancelled ? "Cancelled" : "Refunded"}</span>;
  if (!canSign || !canRefund(order)) return null;
  return (
    <button
      type="button"
      className="mx-button mx-button--money mx-action"
      onClick={(event) => {
        event.stopPropagation();
        startedHere.current = true;
        onRefund();
      }}
    >
      {refundLabel(order)} USDT
    </button>
  );
}

interface UnlockFormProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onUnlocked: () => void;
  onCancel: () => void;
}

/** The hosted console reads without a key. Refunds need the merchant's token, kept for this tab only. */
function UnlockForm({ inputRef, onUnlocked, onCancel }: UnlockFormProps) {
  const id = useId();
  const errorId = useId();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockRefunds(token);
      setToken("");
      onUnlocked();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mx-unlock" onSubmit={(event) => void submit(event)}>
      <label className="mx-field__label" htmlFor={id}>
        Merchant token
      </label>
      <div className="mx-unlock__row">
        <input
          ref={inputRef}
          id={id}
          className="mx-input__field mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={token}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className="mx-button" disabled={busy}>
          {busy ? "Checking…" : "Unlock refunds"}
        </button>
        <button type="button" className="mx-button mx-button--quiet" onClick={onCancel}>
          Not now
        </button>
      </div>
      {error ? (
        <p className="mx-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : (
        <p className="mx-note">Kept in this tab only and sent to your merchant service, nowhere else.</p>
      )}
    </form>
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
