import { useState } from "react";
import { recordSpend } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { VIEWS } from "../../app/routes.ts";
import { api, useResource, type JobView } from "../../lib/api.ts";
import { formatAmount, nowUnix, remainingAtomic, usd } from "../../lib/format.ts";
import type { Approval, Purchase } from "../../lib/types.ts";
import { Mark } from "../../ui/Mark.tsx";
import { cx, FixtureNote } from "../../ui/primitives.tsx";
import { Approvals } from "./Approvals.tsx";
import { AskTab } from "./AskTab.tsx";
import { EnvelopeTab } from "./EnvelopeTab.tsx";
import { HistoryTab } from "./HistoryTab.tsx";
import "./buyer.css";

type Tab = "approvals" | "ask" | "envelope" | "history";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "approvals", label: "Approvals" },
  { id: "ask", label: "Ask" },
  { id: "envelope", label: "Envelope" },
  { id: "history", label: "History" },
];

/** The buyer is a phone: 390 px, one column, thumb-reach actions at the bottom. */
export default function BuyerPage({ query }: PageProps) {
  const tab = TABS.find((t) => t.id === query.get("tab"))?.id ?? "approvals";
  const envelope = useResource(() => api.envelope(), []);
  const approvals = useResource(() => api.approvals(), []);
  const purchases = useResource(() => api.purchases(), []);
  /** Approvals the human has countersigned: no longer waiting, even while they settle. */
  const [signed, setSigned] = useState<string[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);

  const fixtures = [envelope, approvals, purchases].some((r) => r.source === "fixtures");
  const waiting = (approvals.data ?? []).filter((a) => !signed.includes(a.id)).length;

  const view = envelope.data;
  const left = view ? usd(remainingAtomic(view.envelope.cap, view.spent.total)) : undefined;
  const revoked = view?.envelope.revoked ?? false;

  /** A countersigned call has finished: list it, and count it against the envelope if it released. */
  const settle = (a: Approval, job: JobView) => {
    const status = job.step === "released" ? "released" : job.step === "refunded" ? "refunded" : "refused";
    const purchase: Purchase = {
      jobId: (job.fundTx ?? `0x${a.id}`) as Purchase["jobId"],
      offerHash: a.listing.hash,
      title: a.listing.offer.title,
      adapter: a.listing.offer.adapter,
      seller: { name: a.listing.seller.name, address: a.listing.offer.seller },
      amount: a.amount,
      rail: a.rail,
      status,
      at: nowUnix(),
      slipHash: job.slipHash as Purchase["slipHash"],
      approvedBy: "you",
      reason:
        status === "refused"
          ? "Refused. The price moved after you signed."
          : status === "refunded"
            ? "Refunded. The deadline passed."
            : undefined,
    };
    if (purchases.data) purchases.set([purchase, ...purchases.data]);
    if (status === "released" && view) {
      envelope.set({
        ...view,
        spent: recordSpend(view.spent, { seller: a.listing.offer.seller, offerHash: a.listing.hash, amount: a.amount }),
      });
    }
  };

  const tabHref = (id: Tab) => {
    const q = new URLSearchParams(query);
    if (id === "approvals") q.delete("tab");
    else q.set("tab", id);
    const s = q.toString();
    return `/buyer${s ? `?${s}` : ""}`;
  };

  return (
    <div className="phone-stage">
    <aside className="phone-note" aria-label="About this view">
      <p className="phone-note__eyebrow">Buyer · phone</p>
      <p className="phone-note__title">The human side of an agent's purchase.</p>
      <p className="phone-note__body">
        Your agent buys inside the envelope you set. Above your limit it waits, and you hold to countersign the exact offer
        and amount.
      </p>
      <nav className="phone-note__nav" aria-label="Other views">
        <Link to="/">Overview</Link>
        {VIEWS.filter((v) => v.name !== "buyer").map((v) => (
          <Link key={v.name} to={`/${v.name}`}>
            {v.label}
          </Link>
        ))}
      </nav>
    </aside>
    <div className="phone">
      <header className="phone__bar">
        <button
          type="button"
          className="phone__brand"
          aria-expanded={viewsOpen}
          aria-controls="phone-views"
          aria-label="countersign, switch view"
          onClick={() => setViewsOpen((o) => !o)}
        >
          <Mark size={22} />
          <span className="phone__name">countersign</span>
          <svg className={viewsOpen ? "phone__chevron is-open" : "phone__chevron"} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="phone__bar-end">
          <FixtureNote show={fixtures} />
          {view && left ? (
            <Link
              to={tabHref("envelope")}
              className={cx("phone__budget num", revoked && "phone__budget--revoked")}
              aria-label={revoked ? "Envelope revoked" : `${formatAmount(left)} ${left.asset.symbol} left. Open the envelope.`}
            >
              {revoked ? (
                "Revoked"
              ) : (
                <>
                  <span className="phone__budget-amount">{formatAmount(left)}</span> left
                </>
              )}
            </Link>
          ) : null}
        </div>
      </header>
      {viewsOpen ? (
        <nav id="phone-views" className="phone__views" aria-label="Views">
          <p className="phone__views-label">You are on the buyer's phone. Other views:</p>
          <Link to="/" className="phone__views-link">
            Overview
          </Link>
          {VIEWS.filter((v) => v.name !== "buyer").map((v) => (
            <Link key={v.name} to={`/${v.name}`} className="phone__views-link">
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="phone__body">
        {tab === "approvals" ? (
          <Approvals
            approvals={approvals}
            envelope={envelope}
            query={query}
            onSigned={(a) => setSigned((s) => [...s, a.id])}
            onSettled={settle}
            onClose={(a) => approvals.set((approvals.data ?? []).filter((x) => x.id !== a.id))}
          />
        ) : null}
        {tab === "ask" ? <AskTab envelope={envelope} /> : null}
        {tab === "envelope" ? <EnvelopeTab envelope={envelope} /> : null}
        {tab === "history" ? <HistoryTab purchases={purchases} /> : null}
      </div>

      <nav className="tabbar" aria-label="Buyer">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t.id)} className="tabbar__tab" aria-current={tab === t.id ? "page" : undefined}>
            <TabIcon id={t.id} />
            <span className="tabbar__label">{t.label}</span>
            {t.id === "approvals" && waiting > 0 ? (
              <span className="tabbar__badge num" aria-label={`${waiting} waiting`}>
                {waiting}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
    </div>
  );
}

function TabIcon({ id }: { id: Tab }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 22 22",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (id === "approvals") {
    // A signature on a line.
    return (
      <svg {...common}>
        <path d="M3 14c1.5-5 4.5-6 6.4-3.2.9 1.4 1.6 2.6 3.1 2.6 1.6 0 2.8-2.4 4-5.4" />
        <path d="M3 18h16" />
      </svg>
    );
  }
  if (id === "ask") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="5.5" />
        <path d="M14.2 14.2L18 18" />
      </svg>
    );
  }
  if (id === "envelope") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="16" height="12" rx="2" />
        <path d="M3.5 6l7.5 6 7.5-6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 6h12M5 11h12M5 16h8" />
    </svg>
  );
}
