import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { navigate } from "../../app/router.tsx";
import type { Equation, Order, OrderFilter, ReceiptOrder, RefundReason, RefundRecord, Refusal, RelayStatus } from "./model.ts";
import {
  ORDER_FILTERS,
  addressUrl,
  adjustments,
  assetOf,
  dateStamp,
  decimalsFor,
  equation,
  explorerOf,
  filterCounts,
  formatFixed,
  formatUsdt,
  formatWbt,
  formatWeiWbt,
  humanDate,
  isEscrowOpen,
  isWhitechain,
  itemLabel,
  ledger,
  matchesFilter,
  networkNameOf,
  ordersCsv,
  refundLabel,
  refusalWords,
  shortAddress,
  shortHash,
  shortHumanDate,
  statusLabel,
  statusTone,
  txUrl,
  type ReturnKind,
} from "./model.ts";
import {
  RELAY_URL,
  canSignRefunds,
  fetchOfferTitle,
  fetchOrder,
  fetchOrders,
  fetchRelayStatus,
  probeMerchantService,
  refundOrder,
  resolveMerchant,
  unlockRefunds,
  type OrdersSource,
} from "./api.ts";
import {
  OrderPanel,
  ReviewCountdown,
  Sheet,
  UNDO_MS,
  UndoStrip,
  awayWords,
  canAct,
  offersRefund,
  type PanelView,
  type PartOutcome,
  type RefundAccess,
  type RowState,
} from "./Panel.tsx";

/** The sample ledger, imported only on ?hub=off so the default bundle never carries it. */
type Sample = typeof import("./fixtures.ts");

const POLL_MS = 4000;
const STATUS_POLL_MS = 5000;
const HIGHLIGHT_MS = 1200;
/** From this width the order opens beside the ledger; below it, as a sheet over it. */
const SPLIT_QUERY = "(min-width: 1100px)";

interface DeskProps {
  /** ?hub=off: the sample ledger. Everything else reads the live hub. */
  offline: boolean;
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

function hubLabel(base: string): string {
  if (base.startsWith("/")) return "this console's hub";
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

function Unit({ symbol }: { symbol: string }) {
  return <span className="mx-unit">{symbol}</span>;
}

export function Desk({ offline, merchantQuery }: DeskProps) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  /** null until resolved; then the address, or "" when nothing names a merchant. */
  const [merchant, setMerchant] = useState<string | null>(null);
  const [source, setSource] = useState<OrdersSource | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [asset, setAsset] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [refusals, setRefusals] = useState<Record<string, Refusal[]>>({});
  const [added, setAdded] = useState<Record<string, RefundRecord[]>>({});
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("detail");
  const [detail, setDetail] = useState<ReceiptOrder | null>(null);
  const [access, setAccess] = useState<RefundAccess>(() => ({ kind: offline ? "sample" : "checking" }));
  const [unlockOpen, setUnlockOpen] = useState(false);

  const split = useMedia(SPLIT_QUERY);
  const touch = useMedia("(hover: none)");
  const seenRef = useRef<Set<string> | null>(null);
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
    setLoadError(null);
  }, []);

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

  // ?hub=off: the sample ledger, fetched as its own chunk. Nothing else ever loads it.
  useEffect(() => {
    if (!offline) return;
    let cancelled = false;
    void import("./fixtures.ts").then((module) => {
      if (cancelled) return;
      setSample(module);
      seenRef.current = new Set(module.fixtureOrders.map((order) => order.id));
      setOrders(module.fixtureOrders);
      setMerchant(module.fixtureMerchant);
      setRelayStatus(module.fixtureStatus);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [offline]);

  // Live: whose desk. ?merchant=, the hosted build's address, or the merchant's own service.
  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    void resolveMerchant(merchantQuery).then((address) => {
      if (!cancelled) setMerchant(address ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [offline, merchantQuery]);

  // Live: can this page refund? Only through the merchant service that signs for this merchant.
  useEffect(() => {
    if (offline || !merchant) return;
    let cancelled = false;
    void probeMerchantService().then((signer) => {
      if (cancelled) return;
      if (!signer || signer.toLowerCase() !== merchant.toLowerCase()) setAccess({ kind: "away", signer });
      else setAccess({ kind: canSignRefunds() ? "ready" : "locked" });
    });
    return () => {
      cancelled = true;
    };
  }, [offline, merchant]);

  const refresh = useCallback(async () => {
    if (offline || !merchant || pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const result = await fetchOrders(merchant);
      if (!mountedRef.current) return;
      setSource(result.source);
      applyOrders(result.orders);
    } catch (error) {
      if (mountedRef.current) setLoadError(messageOf(error));
    } finally {
      pollBusyRef.current = false;
    }
  }, [applyOrders, offline, merchant]);

  // Live orders, every few seconds while the tab is visible, so a payment shows up as it settles.
  useEffect(() => {
    if (offline || !merchant) return;
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
  }, [offline, merchant, refresh]);

  // The Whitechain relayer's gas, when this console can reach the relay. Silent otherwise.
  useEffect(() => {
    if (offline) return;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      fetchRelayStatus()
        .then((next) => {
          if (mountedRef.current) setRelayStatus(next);
        })
        .catch(() => {
          if (mountedRef.current) setRelayStatus(null);
        });
    };
    read();
    const interval = window.setInterval(read, STATUS_POLL_MS);
    return () => window.clearInterval(interval);
  }, [offline]);

  // Offer titles from the hub, once per offer, for orders that carry no description.
  useEffect(() => {
    if (offline) return;
    for (const order of orders) {
      const hash = order.offerHash;
      if (!hash || order.description || requestedTitlesRef.current.has(hash)) continue;
      requestedTitlesRef.current.add(hash);
      void fetchOfferTitle(hash).then((title) => {
        if (mountedRef.current && title) setTitles((current) => ({ ...current, [hash]: title }));
      });
    }
  }, [offline, orders]);

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
    if (offline) {
      setDetail(sample ? sample.fixtureDetail(selected, added[selected.id] ?? []) : null);
      return;
    }
    let cancelled = false;
    fetchOrder(selected.id)
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
  }, [version, offline, sample, added]);

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

  /** The sample ledger's stand-in for the chain: the changes a relay would report, and nothing more. */
  const simulateRefund = (order: Order, amount: bigint, txHash: string, reason: RefundReason | null = null) => {
    const cancelled = isEscrowOpen(order.status);
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
    const cancelled = isEscrowOpen(order.status);

    if (offline) {
      if (!sample) return;
      await wait(700);
      const txHash = sample.fixtureRefundTx(order.id, (added[order.id]?.length ?? 0) + 1);
      simulateRefund(order, BigInt(order.refundable), txHash);
      setRow(order.id, { kind: "done", txHash, amount: order.refundable, cancelled, before: order.refundable });
      return;
    }

    try {
      // Exactly the figure the merchant confirmed: the service signs that or refuses (cs-w1 B15).
      const result = await refundOrder(order.id, { amount: BigInt(order.refundable) });
      if (!mountedRef.current) return;
      if (result.ok === true) {
        setRow(order.id, {
          kind: "done",
          txHash: result.txHash,
          amount: result.refunded ?? order.refundable,
          cancelled,
          before: order.refundable,
        });
      } else if (result.ok === "unknown") {
        setRow(order.id, { kind: "unknown", message: result.reason, before: order.refundable });
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
    if (!canAct(access) || undoTimersRef.current.has(order.id)) return;
    setRow(order.id, { kind: "undo" });
    const timer = window.setTimeout(() => void sendRefund(order), UNDO_MS);
    undoTimersRef.current.set(order.id, timer);
  };

  /** Takes a refund back only while its window is open; once it has left, Undo changes nothing. */
  const undoRefund = (id: string) => {
    const timer = undoTimersRef.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    undoTimersRef.current.delete(id);
    setRow(id, null);
  };

  /** A partial refund from the panel. Deliberate already (two steps), so it sends at once. */
  const refundPart = async (order: Order, amount: bigint, reason: RefundReason): Promise<PartOutcome> => {
    if (!canAct(access)) return { ok: false, reason: "Refunds cannot be signed from this page." };
    const current = rows[order.id];
    if (undoTimersRef.current.has(order.id) || current?.kind === "undo" || current?.kind === "sending") {
      return { ok: false, reason: "A refund for this order is already on its way." };
    }
    setRow(order.id, { kind: "sending" });
    if (offline) {
      if (!sample) return { ok: false, reason: "The sample ledger is still loading." };
      await wait(700);
      const txHash = sample.fixtureRefundTx(order.id, (added[order.id]?.length ?? 0) + 1);
      simulateRefund(order, amount, txHash, reason);
      setRow(order.id, { kind: "done", txHash, amount: amount.toString(), cancelled: false, before: order.refundable });
      return { ok: true };
    }
    try {
      const result = await refundOrder(order.id, { amount, reason });
      if (!mountedRef.current) return { ok: true };
      if (result.ok === "unknown") {
        setRow(order.id, { kind: "unknown", message: result.reason, before: order.refundable });
        return { ok: "unknown" };
      }
      if (result.ok === false) {
        setRow(order.id, null);
        addRefusal(order.id, result.reason);
        return { ok: false, reason: result.reason };
      }
      setRow(order.id, {
        kind: "done",
        txHash: result.txHash,
        amount: result.refunded ?? amount.toString(),
        cancelled: false,
        before: order.refundable,
      });
      return { ok: true };
    } catch (error) {
      if (mountedRef.current) setRow(order.id, null);
      return { ok: false, reason: messageOf(error) };
    } finally {
      void refresh();
    }
  };

  // One asset per ledger: a sum never mixes two currencies. The newest order's asset leads.
  const symbols = useMemo(() => [...new Set(orders.map(assetOf))], [orders]);
  const newest = useMemo(() => orders.reduce<Order | null>((a, b) => (a && a.createdAt >= b.createdAt ? a : b), null), [orders]);
  const active = asset && symbols.includes(asset) ? asset : newest ? assetOf(newest) : "USDT";
  const book = useMemo(() => orders.filter((order) => assetOf(order) === active), [orders, active]);

  const sums = useMemo(() => equation(book), [book]);
  const counts = useMemo(() => filterCounts(book), [book]);
  const lines = useMemo(() => ledger(book), [book]);
  const visible = useMemo(() => lines.filter((entry) => matchesFilter(entry.order, filter)), [lines, filter]);
  // One precision for the whole desk, so the band, the amounts and the balances line up as one statement.
  const places = useMemo(
    () =>
      decimalsFor([
        ...book.map((order) => BigInt(order.amount)),
        ...lines.map((entry) => entry.balance),
        sums.released,
        sums.refunded,
        sums.toll,
        sums.bondLost,
        sums.net,
        sums.held,
      ]),
    [book, lines, sums],
  );
  const networks = useMemo(() => [...new Set(book.map(networkNameOf))], [book]);
  const explorer = book[0] ? explorerOf(book[0]) : undefined;
  const showsGas = relayStatus !== null && (book.length === 0 || book.some(isWhitechain));
  const receiptQuery = offline ? "?hub=off" : "";
  const titleOf = (order: Order) => itemLabel(order, order.offerHash ? titles[order.offerHash] : null);
  const panelOpen = selected !== null;

  const handleExport = () => {
    setExportError(null);
    try {
      const url = URL.createObjectURL(new Blob([ordersCsv(book)], { type: "text/csv;charset=utf-8" }));
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
    }
  };

  const panel = selected ? (
    <OrderPanel
      order={selected}
      detail={detail && detail.id === selected.id ? detail : null}
      item={titleOf(selected)}
      row={rows[selected.id]}
      refusals={refusals[selected.id] ?? []}
      access={access}
      places={places}
      isStandIn={sample?.isStandIn}
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

  let body;
  if (merchant === "") {
    body = <MerchantForm />;
  } else if (!loaded && loadError) {
    body = (
      <div className="mx-empty" role="alert">
        <p>{loadError}</p>
        <p className="mx-muted">Nothing is shown in its place: no sample data, no zeros.</p>
        <button type="button" className="mx-button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  } else if (!loaded) {
    body = merchant ? (
      <p className="mx-note" role="status">
        Reading orders…
      </p>
    ) : null;
  } else if (book.length === 0) {
    body = <FirstPayment merchant={merchant ?? ""} />;
  } else if (visible.length === 0) {
    body = (
      <div className="mx-empty">
        <p>No orders match this filter.</p>
        <button type="button" className="mx-button" onClick={() => setFilter("all")}>
          Show all orders
        </button>
      </div>
    );
  } else {
    body = (
      <table className="mx-table">
        <caption className="sr-only">
          Orders, newest first. Balance is the running total of money that reached you; held and settling orders are
          pending and not counted.
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
          {visible.map(({ order, balance, pending }) => {
            const row = rows[order.id];
            const item = titleOf(order);
            const isOpen = order.id === selectedId;
            const inFlight = isEscrowOpen(order.status) || order.status === "pending";
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
                      title={item}
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
                      {formatFixed(BigInt(order.amount), places)}
                      <Unit symbol={active} />
                    </span>
                    <Adjustments order={order} />
                  </td>
                  <td className="mx-col-balance mx-num">
                    {pending ? (
                      <span className="mx-quiet" title="Not counted until the money reaches you.">
                        Pending
                      </span>
                    ) : (
                      <span className="mono">
                        {formatFixed(balance, places)}
                        <Unit symbol={active} />
                      </span>
                    )}
                  </td>
                  <td className="mx-col-actions">
                    <RowAction
                      order={order}
                      row={row}
                      access={access}
                      onRefund={() => startRefund(order)}
                      onUndo={() => undoRefund(order.id)}
                    />
                  </td>
                </tr>
                {row?.kind === "done" || row?.kind === "error" || row?.kind === "unknown" ? (
                  <tr className="mx-result-row">
                    <td colSpan={7}>
                      {row.kind === "done" ? (
                        <p className="mx-result" role="status">
                          {row.cancelled ? "Cancelled" : "Refunded"}. {formatUsdt(row.amount)} {active} returned to{" "}
                          <span className="mono">{shortAddress(order.customer)}</span>.{" "}
                          {sample?.isStandIn(row.txHash) ? (
                            <span className="mono" title="A stand-in in the sample ledger, not a real transaction">
                              {shortHash(row.txHash)}
                            </span>
                          ) : (
                            <a
                              className="mono mx-tx"
                              href={txUrl(row.txHash, explorerOf(order))}
                              title={row.txHash}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {shortHash(row.txHash)}
                            </a>
                          )}
                        </p>
                      ) : row.kind === "unknown" ? (
                        <p className="mx-result" role="status">
                          {row.message} Reload to see whether it settled before refunding again.
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
    );
  }

  return (
    <div className="mx-page">
      <header className="mx-head">
        <div className="mx-head__id">
          <h1 className="mx-title">Merchant</h1>
          <p className="mx-sub">
            {networks.length > 0 ? `${networks.join(", ")} · ${active}` : "Merchant ledger"}
            {merchant ? (
              <>
                <span aria-hidden="true"> · </span>
                <a className="mono" href={addressUrl(merchant, explorer)} title={merchant} target="_blank" rel="noreferrer">
                  {shortAddress(merchant)}
                </a>
              </>
            ) : null}
          </p>
          <SourceLine offline={offline} source={source} />
        </div>
        {showsGas && relayStatus ? <GasLine status={relayStatus} /> : null}
      </header>

      {symbols.length > 1 ? (
        <div className="mx-filters" role="group" aria-label="Currency">
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className="mx-filter"
              aria-pressed={symbol === active}
              onClick={() => setAsset(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      ) : null}

      {merchant === "" ? null : <EquationBand sums={sums} ready={loaded} unit={active} places={places} />}

      <div className={`mx-desk${panelOpen && split ? " mx-desk--split" : ""}`}>
        <section className="mx-orders" aria-labelledby="mx-orders-heading">
          {loaded && book.length > 0 ? (
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
                {access.kind === "locked" && !unlockOpen ? (
                  <button type="button" className="mx-button mx-button--quiet" onClick={openUnlock}>
                    Unlock refunds
                  </button>
                ) : null}
                <button type="button" className="mx-button" onClick={handleExport}>
                  Export for accountant
                </button>
              </div>
            </div>
          ) : (
            <h2 className="sr-only" id="mx-orders-heading">
              Orders
            </h2>
          )}

          {unlockOpen && access.kind === "locked" ? (
            <UnlockForm
              inputRef={unlockInputRef}
              onUnlocked={() => {
                setAccess({ kind: "ready" });
                setUnlockOpen(false);
              }}
              onCancel={() => setUnlockOpen(false)}
            />
          ) : null}
          {access.kind === "away" && merchant && loaded && book.length > 0 ? (
            <p className="mx-note">Read only. {awayWords(access, merchant)}</p>
          ) : null}
          {exportError ? <p className="mx-note">{exportError}</p> : null}
          {loaded && loadError ? (
            <p className="mx-note" role="status">
              {loadError} Showing the last answer.
            </p>
          ) : null}

          {body}
        </section>

        {panel && split ? (
          <aside className="mx-panel" aria-label="Order">
            {panel}
          </aside>
        ) : null}
      </div>

      {panel && !split ? (
        <Sheet label="Order" onClose={closePanel}>
          {panel}
        </Sheet>
      ) : null}
    </div>
  );
}

/** Says where the ledger came from, so a sample or a fallback is never mistaken for the hub. */
function SourceLine({ offline, source }: { offline: boolean; source: OrdersSource | null }) {
  if (offline) {
    return (
      <p className="mx-note">
        Sample ledger (?hub=off): four rows link to real Whitechain Sepolia transactions, two are made up, and the times
        are illustrative.
        {import.meta.env.DEV
          ? " On this dev server, five more made-up rows show escrow v2's review states, which are not live yet."
          : ""}
      </p>
    );
  }
  if (!source) return null;
  if (source.kind === "hub") return <p className="mx-note">Live from {hubLabel(source.base)}.</p>;
  return (
    <p className="mx-note">
      Live from the Whitechain relay:{" "}
      {source.why === "down" ? "the hub did not answer." : "this hub does not serve merchant orders yet."}
    </p>
  );
}

/**
 * Released − refunded − toll = net, ruled like the top of a statement. Held escrow stands beside the
 * sum as pending, because it is not the merchant's until delivery releases it. Until the ledger
 * loads, the figures hold their place with dashes rather than flash a row of zeros.
 */
function EquationBand({ sums, ready, unit, places }: { sums: Equation; ready: boolean; unit: string; places: number }) {
  const show = (value: bigint) => (ready ? formatFixed(value, places) : "—");
  const terms: ReadonlyArray<{ label: string; value: bigint; op: "−" | "=" | null }> = [
    { label: "Released", value: sums.released, op: null },
    { label: "Refunded", value: sums.refunded, op: "−" },
    { label: "Toll", value: sums.toll, op: "−" },
    ...(sums.bondLost > 0n ? [{ label: "Bond lost", value: sums.bondLost, op: "−" as const }] : []),
    { label: "Net", value: sums.net, op: "=" },
  ];
  return (
    <section className="mx-eq" aria-label="Balance">
      <dl className="mx-eq__terms">
        {terms.map((term) => (
          <div
            className={`mx-eq__term${term.op === "=" ? " mx-eq__term--sum mx-eq__term--net" : ""}`}
            data-op={term.op ?? undefined}
            key={term.label}
          >
            <dt className="mx-label">{term.label}</dt>
            <dd className="mx-eq__value mono">
              {show(term.value)}
              <Unit symbol={unit} />
            </dd>
          </div>
        ))}
      </dl>
      {ready && sums.held === 0n ? null : (
        <dl className="mx-eq__held">
          <div className="mx-eq__term">
            <dt className="mx-label">Held</dt>
            <dd className="mx-eq__value mono mx-money">
              {show(sums.held)}
              <Unit symbol={unit} />
            </dd>
            <dd className="mx-eq__note">Pending until the escrow releases.</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function GasLine({ status }: { status: RelayStatus }) {
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

const RETURN_WORDS: Record<ReturnKind, string> = {
  cancel: "cancelled",
  deadline_refund: "deadline refund",
  dispute_refund: "disputed",
  delivery_failed: "delivery failed",
};

/**
 * Why the balance moved by less than the amount: the toll, a refund, a cancel, a dispute, a failed
 * delivery and the bond it cost; or that the money is still in flight, with the review clock.
 */
function Adjustments({ order }: { order: Order }) {
  const lines = adjustments(order);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line) => (
        <span className="mx-adjust" key={line.kind}>
          {line.kind === "held" ? (
            "Releases on delivery"
          ) : line.kind === "settling" ? (
            "Settling"
          ) : line.kind === "review" ? (
            line.endsAt ? (
              <>
                Review <ReviewCountdown endsAt={line.endsAt} />
              </>
            ) : (
              "In review"
            )
          ) : (
            `−${formatUsdt(line.amount.toString())} ${
              line.kind === "toll"
                ? "toll"
                : line.kind === "refunded"
                  ? "refunded"
                  : line.kind === "bond"
                    ? "bond lost"
                    : RETURN_WORDS[line.close]
            }`
          )}
        </span>
      ))}
    </>
  );
}

interface RowActionProps {
  order: Order;
  row: RowState | undefined;
  access: RefundAccess;
  onRefund: () => void;
  onUndo: () => void;
}

function RowAction({ order, row, access, onRefund, onUndo }: RowActionProps) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const startedHere = useRef(false);
  const held = isEscrowOpen(order.status);

  // A keyboard user who refunds from the row lands on Undo, one keypress from taking it back.
  useEffect(() => {
    if (row?.kind === "undo" && startedHere.current) undoRef.current?.focus();
    if (row?.kind !== "undo") startedHere.current = false;
  }, [row?.kind]);

  if (row?.kind === "undo") return <UndoStrip order={order} onUndo={onUndo} undoRef={undoRef} />;
  if (row?.kind === "sending") return <span className="mx-quiet">{held ? "Cancelling…" : "Refunding…"}</span>;
  if (!canAct(access) || !offersRefund(order, row)) {
    if (row?.kind === "unknown") return <span className="mx-quiet">Unconfirmed</span>;
    return row?.kind === "done" ? <span className="mx-quiet">{row.cancelled ? "Cancelled" : "Refunded"}</span> : null;
  }
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
      {refundLabel(order)} {assetOf(order)}
    </button>
  );
}

interface UnlockFormProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onUnlocked: () => void;
  onCancel: () => void;
}

/** The merchant service answers reads without a key; a refund needs its token, kept for this tab only. */
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

/** Nothing names a merchant (a hosted console has no merchant service): ask whose ledger to read. */
function MerchantForm() {
  const id = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      setError("Enter the seller's 0x address: 0x and 40 hex characters.");
      return;
    }
    navigate(`/merchant?merchant=${address}`);
  };

  return (
    <form className="mx-empty" onSubmit={submit} noValidate>
      <p>Whose ledger?</p>
      <p className="mx-muted">Name the seller. This console reads its orders from the hub and holds no keys.</p>
      <div className="mx-unlock__row">
        <label className="sr-only" htmlFor={id}>
          Seller address
        </label>
        <input
          id={id}
          className="mx-input__field mono"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="0x…"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="mx-button">
          Open the ledger
        </button>
      </div>
      {error ? (
        <p className="mx-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
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
      <p className="mx-muted">The hub reports no orders for this seller. Add the paywall to your API in one line:</p>
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
