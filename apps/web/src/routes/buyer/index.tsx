import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { recordSpend } from "@countersign/core";
import { WalletModeContext } from "../../app/Providers.tsx";
import type { PageProps } from "../../app/routes.ts";
import { Link, navigate } from "../../app/router.tsx";
import { api, useResource, type JobView } from "../../lib/api.ts";
import { formatAgo, formatAmount, nowUnix, remainingAtomic, shortHex, usd } from "../../lib/format.ts";
import { chosenAgent, chosenHub, forgetChoices } from "../../lib/hub.ts";
import type { Approval, EnvelopeView, Purchase } from "../../lib/types.ts";
import type { Resource } from "../../lib/api.ts";
import { Drawer } from "../../ui/Drawer.tsx";
import { Amount, cx, FixtureNote, Status } from "../../ui/primitives.tsx";
import { Approvals } from "./Approvals.tsx";
import { AskTab } from "./AskTab.tsx";
import { EnvelopeTab } from "./EnvelopeTab.tsx";
import { HistoryTab } from "./HistoryTab.tsx";
import { mergeApprovals } from "./queue.ts";
import { SignedInAgent } from "./SignedInAgent.tsx";
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
 * The buyer: the human behind an agent. On a desk, the requests waiting for you are the page, with
 * your envelope and history beside them; their full views open in a drawer from the right, at the
 * same ?tab= addresses the phone uses. On a phone it is one column with a tab bar under the thumb.
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
  const reloadEnvelope = envelope.reload;
  const reloadApprovals = approvals.reload;
  const reloadPurchases = purchases.reload;
  /** A fresh token or a newly created envelope changes every read on this phone. */
  const openAll = useCallback(() => {
    reloadEnvelope();
    reloadApprovals();
    reloadPurchases();
  }, [reloadEnvelope, reloadApprovals, reloadPurchases]);
  /** Approvals the human has countersigned: no longer waiting, even while they settle. */
  const [signed, setSigned] = useState<string[]>([]);
  const privy = useContext(WalletModeContext).privy;
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

  const narrow = useNarrowBuyer();

  const chosen =
    agent || hub ? (
      <p className="buyer__chosen" data-testid="buyer-chosen">
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
    ) : null;

  const approvalsView = (
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
      onOpen={openAll}
    />
  );

  const budget =
    view && left ? (
      <Link
        to={tabHref("envelope")}
        className={cx("buyer__budget num", revoked && "buyer__budget--revoked")}
        aria-label={revoked ? "Envelope revoked" : `${formatAmount(left)} ${left.asset.symbol} left. Open the envelope.`}
      >
        {revoked ? (
          "Revoked"
        ) : (
          <>
            <span className="buyer__budget-amount">{formatAmount(left)}</span> left
          </>
        )}
      </Link>
    ) : null;

  if (narrow) {
    return (
      <div className="buyer buyer--phone">
        {privy ? <SignedInAgent onChange={openAll} /> : null}
        <header className="buyer__bar">
          <p className="buyer__bar-title">Buyer</p>
          <div className="buyer__bar-end">
            <FixtureNote show={fixtures} />
            {budget}
          </div>
        </header>
        {chosen}
        <div className="buyer__body">
          {tab === "approvals" ? approvalsView : null}
          {tab === "ask" ? <AskTab envelope={envelope} /> : null}
          {tab === "envelope" ? <EnvelopeTab envelope={envelope} onOpen={openAll} /> : null}
          {tab === "history" ? <HistoryTab purchases={purchases} onOpen={openAll} /> : null}
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
    );
  }

  return (
    <div className="buyer">
      {privy ? <SignedInAgent onChange={openAll} /> : null}
      <header className="buyer__head">
        <div className="buyer__kickers">
          <p className="pill-kicker">The buyer</p>
          <FixtureNote show={fixtures} />
        </div>
        <h1 className="buyer__title">Approve what your agent buys.</h1>
        <p className="buyer__lede">
          Your agent buys inside the envelope you set. Above your limit it waits here, and you countersign the exact offer and
          amount with this browser&apos;s own key.
        </p>
        {chosen}
      </header>

      <div className="buyer__grid">
        <section className="buyer__main" aria-labelledby="buyer-waiting">
          <div className="buyer__section-head">
            <h2 id="buyer-waiting" className="section-label">
              Waiting for you
            </h2>
            {waiting > 0 ? <span className="count-pill num">{waiting}</span> : null}
          </div>
          {approvalsView}
        </section>

        <aside className="buyer__rail" aria-label="Your envelope and history">
          <EnvelopeCard envelope={envelope} left={left} revoked={revoked} href={tabHref("envelope")} />
          <HistoryCard purchases={purchases} href={tabHref("history")} />
          <section className="rail-card rail-card--ask">
            <p className="section-label">Ask</p>
            <p className="rail-card__text">Tell your agent what you need and it finds a paid tool that fits your envelope.</p>
            <Link to="/assistant" className="btn btn--secondary rail-card__go">
              Ask for a paid tool
            </Link>
          </section>
          <section className="rail-card rail-card--how" aria-label="How approvals work">
            <p className="section-label">How it works</p>
            <ol className="buyer-steps">
              <li>Your agent asks only above your limit. Inside it, it buys on its own.</li>
              <li>You see the exact offer, amount and seller, checked against the envelope your agent signed.</li>
              <li>You countersign with this browser&apos;s own key. The hub checks it against the envelope before the agent can pay.</li>
            </ol>
          </section>
        </aside>
      </div>

      {tab !== "approvals" ? (
        <Drawer title={tab === "envelope" ? "Your envelope" : tab === "history" ? "History" : "Ask"} onClose={() => navigate(tabHref("approvals"))}>
          {tab === "ask" ? <AskTab envelope={envelope} /> : null}
          {tab === "envelope" ? <EnvelopeTab envelope={envelope} onOpen={openAll} /> : null}
          {tab === "history" ? <HistoryTab purchases={purchases} onOpen={openAll} /> : null}
        </Drawer>
      ) : null}
    </div>
  );
}

/* The rail's summaries: each opens its full view in the drawer. */

function EnvelopeCard({
  envelope,
  left,
  revoked,
  href,
}: {
  envelope: Resource<EnvelopeView | null>;
  left: ReturnType<typeof usd> | undefined;
  revoked: boolean;
  href: string;
}) {
  const view = envelope.data;
  return (
    <section className="rail-card" aria-labelledby="rail-envelope">
      <div className="rail-card__head">
        <h2 id="rail-envelope" className="section-label">
          Your envelope
        </h2>
        <Link to={href} className="rail-card__link">
          {view?.mirror ? "View" : "Edit limits"}
        </Link>
      </div>
      {view && left ? (
        <>
          <p className="rail-card__big">
            {revoked ? (
              <span className="status status--refused">Revoked</span>
            ) : (
              <>
                <Amount money={left} size="lg" /> <span className="rail-card__quiet">left</span>
              </>
            )}
          </p>
          <div className="rail-meter" aria-hidden="true">
            <span style={{ width: `${spentShare(view)}%` }} />
          </div>
          <dl className="rail-kv">
            <div>
              <dt>Budget</dt>
              <dd>
                <Amount money={usd(view.envelope.cap)} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Per seller</dt>
              <dd>
                <Amount money={usd(view.envelope.perMerchant)} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Ask above</dt>
              <dd>{view.askAbove === null ? "Never" : <Amount money={usd(view.askAbove)} size="sm" />}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="rail-card__text">
          {envelope.source === "absent" ? "This hub has not shared an envelope with this browser." : "Reading your envelope…"}
        </p>
      )}
    </section>
  );
}

function HistoryCard({ purchases, href }: { purchases: Resource<Purchase[] | null>; href: string }) {
  const latest = (purchases.data ?? []).slice(0, 3);
  return (
    <section className="rail-card" aria-labelledby="rail-history">
      <div className="rail-card__head">
        <h2 id="rail-history" className="section-label">
          Recent
        </h2>
        <Link to={href} className="rail-card__link">
          All history
        </Link>
      </div>
      {latest.length > 0 ? (
        <ul className="rail-list">
          {latest.map((p) => (
            <li key={`${p.jobId}-${p.status}`}>
              <span className="rail-list__what">
                <span className="rail-list__title">{p.title || "Untitled offer"}</span>
                <span className="rail-list__meta">
                  {p.seller.name} · {formatAgo(p.at)}
                </span>
              </span>
              <span className="rail-list__end">
                <Amount money={usd(p.amount, p.rail)} size="sm" />
                <Status status={p.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rail-card__text">
          {purchases.source === "absent"
            ? "Your agent's purchases are private to this hub until you open them."
            : purchases.data
              ? "No purchases yet. When your agent buys, each call shows here with its slip."
              : "Reading your history…"}
        </p>
      )}
    </section>
  );
}

function spentShare(view: EnvelopeView): number {
  const cap = Number(view.envelope.cap);
  if (!cap) return 0;
  return Math.min(100, Math.max(0, (Number(view.spent.total) / cap) * 100));
}

/** Below this the buyer is a phone: one column and a tab bar. */
const PHONE_QUERY = "(max-width: 959px)";

function useNarrowBuyer(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(PHONE_QUERY);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
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
