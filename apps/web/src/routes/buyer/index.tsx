import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatAmount, remaining } from "../../lib/format.ts";
import { Mark } from "../../ui/Mark.tsx";
import { cx, FixtureNote } from "../../ui/primitives.tsx";
import { Approvals } from "./Approvals.tsx";
import { EnvelopeTab } from "./EnvelopeTab.tsx";
import { HistoryTab } from "./HistoryTab.tsx";
import "./buyer.css";

type Tab = "approvals" | "envelope" | "history";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "approvals", label: "Approvals" },
  { id: "envelope", label: "Envelope" },
  { id: "history", label: "History" },
];

/** The buyer is a phone: 390 px, one column, thumb-reach actions at the bottom. */
export default function BuyerPage({ query }: PageProps) {
  const tab = (TABS.find((t) => t.id === query.get("tab"))?.id ?? "approvals") as Tab;
  const envelope = useResource(() => api.envelope(), []);
  const approvals = useResource(() => api.approvals(), []);
  const fixtures = envelope.source === "fixtures" || approvals.source === "fixtures";
  const pending = approvals.data?.length ?? 0;

  const tabHref = (id: Tab) => {
    const q = new URLSearchParams(query);
    if (id === "approvals") q.delete("tab");
    else q.set("tab", id);
    const s = q.toString();
    return `/buyer${s ? `?${s}` : ""}`;
  };

  const left = envelope.data ? remaining(envelope.data.cap, envelope.data.spent) : undefined;

  return (
    <div className="phone">
      <header className="phone__bar">
        <Link to="/" className="phone__brand" aria-label="countersign, all views">
          <Mark size={22} />
          <span className="phone__name">countersign</span>
        </Link>
        <div className="phone__bar-end">
          <FixtureNote show={fixtures} />
          {envelope.data && left ? (
            <Link
              to={tabHref("envelope")}
              className={cx("phone__budget num", envelope.data.revoked && "phone__budget--revoked")}
              aria-label={
                envelope.data.revoked
                  ? "Envelope revoked"
                  : `${formatAmount(left)} ${left.asset.symbol} left today. Open the envelope.`
              }
            >
              {envelope.data.revoked ? (
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

      <div className="phone__body">
        {tab === "approvals" ? <Approvals approvals={approvals} envelope={envelope} query={query} /> : null}
        {tab === "envelope" ? <EnvelopeTab envelope={envelope} /> : null}
        {tab === "history" ? <HistoryTab /> : null}
      </div>

      <nav className="tabbar" aria-label="Buyer">
        {TABS.map((t) => (
          <Link key={t.id} to={tabHref(t.id)} className="tabbar__tab" aria-current={tab === t.id ? "page" : undefined}>
            <TabIcon id={t.id} />
            <span className="tabbar__label">{t.label}</span>
            {t.id === "approvals" && pending > 0 ? (
              <span className="tabbar__badge num" aria-label={`${pending} waiting`}>
                {pending}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
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
