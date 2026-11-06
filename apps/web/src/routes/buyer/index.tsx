import { useEffect, useRef, useState } from "react";
import { recordSpend } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link, navigate } from "../../app/router.tsx";
import { api, useResource, type JobView } from "../../lib/api.ts";
import { formatAmount, nowUnix, remainingAtomic, shortHex, usd } from "../../lib/format.ts";
import { chosenAgent, chosenHub, forgetChoices } from "../../lib/hub.ts";
import type { Approval, Purchase } from "../../lib/types.ts";
import { cx, FixtureNote } from "../../ui/primitives.tsx";
import { Approvals } from "./Approvals.tsx";
import { AskTab } from "./AskTab.tsx";
import { EnvelopeTab } from "./EnvelopeTab.tsx";
import { HistoryTab } from "./HistoryTab.tsx";
import { mergeApprovals } from "./queue.ts";
import "./buyer.css";

/** The phone sits inside the console's shell: the top bar is the way to every other view. */
export const surface = "desk";

type Tab = "approvals" | "ask" | "envelope" | "history";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "approvals", label: "Approvals" },
  { id: "ask", label: "Ask" },
  { id: "envelope", label: "Envelope" },
  { id: "history", label: "History" },
];

/**
 * The buyer is a phone: 390 px, one column, thumb-reach actions at the bottom.
 *
 * Asking for another agent or another hub in the address starts the phone afresh: its reads, its
 * polling and what it has countersigned belong to one agent on one hub. Nothing from the previous
 * agent can stay on screen, or be held, while the new one loads.
 */
export default function BuyerPage(props: PageProps) {
  const who = `${props.query.get("hub") ?? ""}|${props.query.get("agent") ?? ""}`;
  return <Phone key={who} {...props} />;
}

function Phone({ query }: PageProps) {
  const tab = TABS.find((t) => t.id === query.get("tab"))?.id ?? "approvals";
  const envelope = useResource(() => api.envelope(), []);
  const approvals = useResource(() => api.approvals(), []);
  const purchases = useResource(() => api.purchases(), []);
  /** Approvals the human has countersigned: no longer waiting, even while they settle. */
  const [signed, setSigned] = useState<string[]>([]);
  const agent = chosenAgent();
  const hub = chosenHub();

  const fixtures = [envelope, approvals, purchases].some((r) => r.source === "fixtures");
  const waiting = (approvals.data ?? []).filter((a) => !signed.includes(a.id)).length;

  /*
   * A live agent waits on its request for a short while, so the phone keeps asking the hub for new
   * ones. Requests already countersigned stay while their job runs; requests closed here stay gone.
   */
  const latest = useRef({ data: approvals.data, signed, closed: new Set<string>() });
  latest.current.data = approvals.data;
  latest.current.signed = signed;
  const setApprovals = approvals.set;
  const polling = approvals.source === "hub";
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const r = await api.approvals().catch(() => null);
      if (!alive || !r || r.source !== "hub" || !r.data) return;
      const { data, signed: keep, closed } = latest.current;
      setApprovals(mergeApprovals(data ?? [], r.data, new Set(keep), closed));
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [polling, setApprovals]);

  const view = envelope.data;
  const left = view ? usd(remainingAtomic(view.envelope.cap, view.spent.total)) : undefined;
  const revoked = view?.envelope.revoked ?? false;

  /** A countersigned call has finished: list it, and count it against the envelope if it released. */
  const settle = (a: Approval, job: JobView) => {
    if (a.agent !== undefined) {
      // A live call: the hub has the job and the agent signs its new spend, so read both again.
      purchases.reload();
      if (envelope.source === "hub") envelope.reload();
      return;
    }
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
      <p className="phone-note__eyebrow">The buyer's phone</p>
      <p className="phone-note__title">The human behind an agent.</p>
      <p className="phone-note__body">
        Your agent buys inside the envelope you set. Above your limit it waits, and you approve the exact offer and amount
        here.
      </p>
    </aside>
    <div className="phone">
      <header className="phone__bar">
        <p className="phone__title">Buyer's phone</p>
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
      <p className="phone__who">You approve what your agent asks to buy.</p>
      {agent || hub ? (
        <p className="phone__chosen" data-testid="buyer-chosen">
          {agent ? (
            <>
              Showing agent <span className="mono">{shortHex(agent)}</span>
            </>
          ) : null}
          {hub ? (
            <>
              {agent ? " on hub " : "On hub "}
              {hubLabel(hub)}
            </>
          ) : null}
          , chosen by a link.{" "}
          <button
            type="button"
            data-testid="buyer-use-my-own"
            onClick={() => {
              forgetChoices();
              navigate("/buyer");
            }}
          >
            Use my own
          </button>
        </p>
      ) : null}

      <div className="phone__body">
        {tab === "approvals" ? (
          <Approvals
            approvals={approvals}
            envelope={envelope}
            query={query}
            onSigned={(a) => setSigned((s) => [...s, a.id])}
            onSettled={settle}
            onClose={(a) => {
              latest.current.closed.add(a.id);
              approvals.set((approvals.data ?? []).filter((x) => x.id !== a.id));
            }}
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

/** The hub as the chosen line names it: a host, this server for /hub, or the stored word as it is. */
function hubLabel(hub: string): string {
  if (hub === "/hub") return "this server";
  try {
    return new URL(hub).host;
  } catch {
    return hub;
  }
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
