import { useState } from "react";
import { RAIL_IDS } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import {
  explorerTemplate,
  formatAgo,
  formatClock,
  formatDay,
  formatTime,
  networkName,
  RAIL_LABEL,
  shortHex,
  startOfToday,
  usd,
} from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import { useNow } from "../../lib/now.ts";
import type { EnvelopeView, Listing, Money, RailDeclaration, RailId, Settlement } from "../../lib/types.ts";
import { envelopeChecklist } from "../../lib/checklist.ts";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, CopyButton, FixtureNote, Hash, RailState, cx } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./home.css";

const REPO = "https://github.com/ss251/countersign";

/**
 * The settlement desk. Top to bottom: what countersign is, the rails this hub clears on, the money
 * that last moved, and the three steps of a purchase, each beside a real artifact from this page.
 */
export default function HomePage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const rails = useResource(() => api.rails(), []);
  const settlements = useResource(() => api.settlements(100), []);
  const envelope = useResource(() => api.envelope(), []);
  const now = useNow();

  const listed = (listings.data ?? []).filter((l) => l.status === "listed");
  const fixtures = [listings, rails, settlements].some((r) => r.source === "fixtures");
  const live = settlements.source === "hub";
  const rows = settlements.data ?? [];
  const featured = listed.find((l) => l.online) ?? listed[0];
  const newest = rows.find((s) => s.kind !== "refunded");
  const hub = hubBase();
  const hubUrl = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const discover = `bun packages/buyer/src/cli.ts discover --hub ${hubUrl}`;

  return (
    <div className="page desk">
      <header className="desk__head">
        <h1 className="desk__purpose">countersign clears agent payments: inside your envelope, countersigned above it, released only on delivery.</h1>
        <FixtureNote show={fixtures} />
      </header>

      <section className="desk__section" aria-labelledby="rails-title">
        <div className="desk__section-head">
          <h2 id="rails-title" className="label">
            Rails
          </h2>
          <p className="desk__aside num">
            {listings.data ? `${listed.length} ${listed.length === 1 ? "offer" : "offers"} · ${listed.filter((l) => l.online).length} online` : null}
          </p>
        </div>
        {rails.error ? (
          <p className="desk__note">The hub did not answer, so its rails cannot be read right now.</p>
        ) : (
          <RailStrip declared={rails.data} listed={listed} settlements={settlements.data} loading={rails.loading && !rails.data} now={now} />
        )}
      </section>

      <section className="desk__section" aria-labelledby="settled-title">
        <div className="desk__section-head">
          <h2 id="settled-title" className="label">
            Last settlements
          </h2>
          <Link to="/verify" className="desk__aside-link">
            Verify a slip
          </Link>
        </div>
        {settlements.error ? (
          <p className="desk__note">The hub did not answer, so its settlements cannot be listed right now.</p>
        ) : settlements.loading && !settlements.data ? (
          <ol className="srows" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="srow srow--skeleton" />
            ))}
          </ol>
        ) : settlements.data === null ? (
          <p className="desk__note">This hub does not list settlements yet. Each slip still links its own transaction.</p>
        ) : rows.length === 0 ? (
          <p className="desk__note">No money has moved on this hub yet. The first release lands here with its transaction.</p>
        ) : (
          <ol className="srows">
            <li className="srow srow--head" aria-hidden="true">
              <span>Offer · job</span>
              <span>Outcome · rail</span>
              <span className="srow__amount">Amount</span>
              <span>Proof</span>
              <span className="srow__age">When</span>
            </li>
            {rows.slice(0, 6).map((s) => (
              <SettlementRow key={`${s.jobId}-${s.kind}`} s={s} live={live} now={now} />
            ))}
          </ol>
        )}
      </section>

      <section className="desk__section" aria-labelledby="clear-title">
        <div className="desk__section-head">
          <h2 id="clear-title" className="label">
            How a purchase clears
          </h2>
        </div>
        <ol className="clear">
          <li className="clear__step">
            <p className="clear__n mono">01</p>
            <h3 className="clear__name">Envelope</h3>
            <p className="clear__body">
              The agent signs its limits once: a budget, a cap per seller, an allowlist, and the amount above which it asks you.
              Inside them it buys alone.
            </p>
            <EnvelopeArtifact
              view={envelope.data ?? undefined}
              live={envelope.source === "hub"}
              missing={envelope.source === "absent" ? envelope.reason : undefined}
              listing={featured}
            />
          </li>
          <li className="clear__step">
            <p className="clear__n mono">02</p>
            <h3 className="clear__name">Countersignature</h3>
            <p className="clear__body">
              Above that amount, you countersign the exact offer hash and price. A settlement at any other amount is refused by
              the chain.
            </p>
            <CountersignArtifact listing={featured} />
          </li>
          <li className="clear__step">
            <p className="clear__n mono">03</p>
            <h3 className="clear__name">Release</h3>
            <p className="clear__body">
              Output that matches the schema releases the escrow and mints a slip anyone can verify without the hub. Miss the
              deadline and anyone can refund.
            </p>
            <ReleaseArtifact s={newest} live={live} />
          </li>
        </ol>
      </section>

      <footer className="desk__foot">
        <div className="command">
          <div className="command__head">
            <p className="label">List this hub’s offers from a terminal</p>
            <CopyButton value={discover} label="discover command" />
          </div>
          <pre className="command__body mono">{discover}</pre>
        </div>
        <nav className="desk__links" aria-label="More">
          <a href={REPO} target="_blank" rel="noreferrer">
            Repository
          </a>
          <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">
            Docs
          </a>
          <Link to="/registry">Registry</Link>
          <Link to="/seller/publish">Publish an offer</Link>
          <Link to="/assistant">Ask for a tool</Link>
        </nav>
      </footer>
    </div>
  );
}

/* The rail strip: every rail countersign speaks, and what this hub does with each. */

type RailRow = {
  id: RailId;
  decl: RailDeclaration | undefined;
  state: "live" | "degraded" | "off";
  why: string;
  last: Settlement | undefined;
  today: bigint;
};

const STATE_WORD = { live: "Live", degraded: "Degraded", off: "Off" } as const;
const STATE_ORDER = { live: 0, degraded: 1, off: 2 } as const;

/*
 * Public proof for a rail this hub does not run: an explorer link or the doc that holds them.
 * A rail with no entry has no public proof yet, and the desk says so instead of borrowing one.
 */
const PROOF: Partial<Record<RailId, { href: string; label: string }>> = {
  escrow: { href: `${REPO}/blob/main/docs/proof.md#arc-testnet-chain-5042002`, label: "proof" },
  gateway: { href: `${REPO}/blob/main/docs/proof.md#arc-testnet-chain-5042002`, label: "proof" },
  whitechain: { href: `${REPO}/blob/main/docs/whitechain.md`, label: "proof" },
  hedera: { href: "https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078", label: "HashScan" },
};

function RailStrip({
  declared,
  listed,
  settlements,
  loading,
  now,
}: {
  declared: RailDeclaration[] | undefined;
  listed: Listing[];
  settlements: Settlement[] | null | undefined;
  loading: boolean;
  now: number;
}) {
  if (loading) {
    return (
      <ol className="rails" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rail rail--skeleton" />
        ))}
      </ol>
    );
  }
  const midnight = startOfToday();
  const rows = RAIL_IDS.map((id): RailRow => {
    const decl = declared?.find((d) => d.id === id);
    const offers = listed.filter((l) => l.offer.rails.includes(id));
    const online = offers.filter((l) => l.online).length;
    const state: RailRow["state"] = !decl ? "off" : online > 0 ? "live" : "degraded";
    const why = !decl
      ? "Not declared by this hub"
      : online > 0
        ? `${online} ${online === 1 ? "seller" : "sellers"} online`
        : offers.length > 0
          ? "No seller online"
          : "No offers listed";
    const mine = (settlements ?? []).filter((s) => s.rail === id);
    const today = mine.filter((s) => s.kind !== "refunded" && s.at >= midnight).reduce((sum, s) => sum + BigInt(s.amount), 0n);
    return { id, decl, state, why, last: mine[0], today };
  }).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  const shown = rows.filter((r) => r.state !== "off");
  const off = rows.filter((r) => r.state === "off");
  const proven = off.filter((r) => PROOF[r.id]);
  const unproven = off.filter((r) => !PROOF[r.id]);

  return (
    <ol className="rails">
      <li className="rail rail--head" aria-hidden="true">
        <span>Rail</span>
        <span>Status</span>
        <span>Last settlement</span>
        <span className="rail__today">Settled today</span>
      </li>
      {shown.map((r) => (
        <li key={r.id} className="rail">
          <span className="rail__name">
            {RAIL_LABEL[r.id]}
            <span className="rail__net">{r.decl ? networkName(r.decl.network) : r.id}</span>
          </span>
          <span className="rail__state">
            <RailState state={r.state}>{STATE_WORD[r.state]}</RailState>
            <span className="rail__why">{r.why}</span>
          </span>
          <span className="rail__last num">
            <span className="sr-only">Last settlement </span>
            {/* Until the settlements arrive there is nothing to say, and a dash would claim there were none. */}
            {settlements === undefined ? null : r.last ? formatAgo(r.last.at, now) : settlements === null ? "Not listed" : "—"}
          </span>
          <span className="rail__today">
            <span className="sr-only">Settled today </span>
            {settlements === undefined ? null : r.state === "off" || settlements === null ? (
              <span className="rail__none">—</span>
            ) : (
              <Amount money={moneyOn(r.today.toString(), r.id, r.decl)} size="sm" className={r.today === 0n ? "rail__zero" : undefined} />
            )}
          </span>
        </li>
      ))}
      {off.length > 0 ? (
        <li className="rail rail--rest">
          <RailState state="off">
            {off.length} more {off.length === 1 ? "rail" : "rails"}, not on this hub
          </RailState>
          <p className="rail__rest">
            {proven.length > 0 ? (
              <>
                Proven on testnet:{" "}
                {proven.map((r, i) => (
                  <span key={r.id}>
                    {RAIL_LABEL[r.id]} (
                    <a href={PROOF[r.id]!.href} target="_blank" rel="noreferrer">
                      {PROOF[r.id]!.label}
                    </a>
                    ){i < proven.length - 1 ? ", " : "."}
                  </span>
                ))}{" "}
              </>
            ) : null}
            {unproven.length > 0 ? <>Specified, not yet live: {unproven.map((r) => RAIL_LABEL[r.id]).join(", ")}.</> : null}
          </p>
        </li>
      ) : null}
    </ol>
  );
}

/** The amount in the asset the rail declares, or the asset its label implies when it declares none. */
function moneyOn(atomic: string, rail: RailId, decl: RailDeclaration | undefined): Money {
  return decl ? { amount: atomic, asset: { symbol: decl.asset.symbol, decimals: decl.asset.decimals } } : usd(atomic, rail);
}

/* One settlement: what was bought, how it ended, what it cost, the proof, and when. */

function SettlementRow({ s, live, now }: { s: Settlement; live: boolean; now: number }) {
  const template = explorerTemplate(s.network);
  // Stand-in transactions are on no chain, so only live rows link out.
  const href = live ? (s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined)) : undefined;
  const refunded = s.kind === "refunded";
  return (
    <li className="srow">
      <span className="srow__what">
        <span className="srow__title" title={s.title || undefined}>
          {s.title || "Untitled offer"}
        </span>
        <span className="srow__job mono" title={s.jobId}>
          {shortHex(s.jobId, 8, 4)}
        </span>
      </span>
      <span className="srow__outcome">
        <span className={cx("status", refunded ? "status--refunded" : "status--settled")}>{refunded ? "Refunded" : "Settled"}</span>
        <span className="srow__rail">{RAIL_LABEL[s.rail]}</span>
      </span>
      <span className="srow__amount">
        <Amount money={usd(s.amount, s.rail)} size="sm" className={refunded ? "amount--void" : undefined} />
      </span>
      <span className="srow__proof">
        {s.tx ? (
          href ? (
            <Hash value={s.tx} href={href} tx copy={false} head={8} tail={6} label="transaction" />
          ) : (
            <span className="mono srow__tx" title={s.tx}>
              {shortHex(s.tx, 8, 6)}
            </span>
          )
        ) : (
          <span className="srow__none">No transaction</span>
        )}
        {s.slipHash ? (
          <Link to={`/slip/${s.slipHash}`} className="srow__slip">
            Slip <span className="mono">{shortHex(s.slipHash, 6, 4)}</span>
          </Link>
        ) : null}
      </span>
      <span className="srow__age num">
        {formatAgo(s.at, now)}
        <span className="srow__when">
          {formatDay(s.at)}, {formatTime(s.at)}
        </span>
      </span>
    </li>
  );
}

/* The three artifacts the steps point at. Each is real data from this hub, or says it is an example. */

function EnvelopeArtifact({
  view,
  live,
  missing,
  listing,
}: {
  view: EnvelopeView | undefined;
  live: boolean;
  /** Why the hub holds no envelope to show, said instead of an example. */
  missing: string | undefined;
  listing: Listing | undefined;
}) {
  if (missing) {
    return (
      <figure className="artifact artifact--empty">
        <figcaption className="artifact__head">
          <span className="label">Signed envelope</span>
        </figcaption>
        <p className="artifact__note">
          {missing} When an agent publishes one, its limits and the checklist for the offer in step 02 appear here.
        </p>
      </figure>
    );
  }
  if (!view) return <div className="artifact artifact--skeleton" aria-hidden="true" />;
  const env = view.envelope;
  const allow = env.allowlist.length;
  // The same rules the phone shows, read against the offer in step 2: the envelope is what decides it.
  const checks = listing
    ? envelopeChecklist(view, {
        seller: listing.offer.seller,
        offerHash: listing.hash,
        amount: listing.offer.price,
        sellerName: listing.seller.named === false ? "this seller" : listing.seller.name,
      })
    : null;
  return (
    <figure className="artifact">
      <figcaption className="artifact__head">
        <span className="label">{live ? "Signed envelope" : "Example envelope"}</span>
        {live && view.mirror ? (
          <span className="artifact__meta num">
            {view.agentName} · {formatClock(view.mirror.signedAt)}
          </span>
        ) : (
          <FixtureNote show />
        )}
      </figcaption>
      <dl className="fields">
        <div>
          <dt className="label">Budget</dt>
          <dd>
            <Amount money={usd(env.cap)} size="sm" />
          </dd>
        </div>
        <div>
          <dt className="label">Spent</dt>
          <dd>
            <Amount money={usd(view.spent.total)} size="sm" />
          </dd>
        </div>
        <div>
          <dt className="label">Per seller</dt>
          <dd>
            <Amount money={usd(env.perMerchant)} size="sm" />
          </dd>
        </div>
        <div>
          <dt className="label">Ask above</dt>
          <dd>{view.askAbove === null ? <span className="fields__word">Never</span> : <Amount money={usd(view.askAbove)} size="sm" />}</dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Allowlist</dt>
          <dd className="fields__word">{allow === 0 ? "Any seller" : `${allow} ${allow === 1 ? "seller" : "sellers"}`}</dd>
        </div>
      </dl>
      {checks && listing ? (
        <div className="artifact__checks">
          <p className="label">Against {listing.offer.title}, in step 02</p>
          <Checklist items={checks} />
        </div>
      ) : null}
    </figure>
  );
}

function CountersignArtifact({ listing }: { listing: Listing | undefined }) {
  const [round, setRound] = useState(0);
  if (!listing) return <div className="artifact artifact--skeleton" aria-hidden="true" />;
  const { offer } = listing;
  return (
    <figure className="artifact">
      <figcaption className="artifact__head">
        <span className="label">{listing.online ? "Live offer" : "Listed offer"}</span>
        <Link to={`/offer/${listing.hash}`} className="artifact__link">
          {offer.title}
        </Link>
      </figcaption>
      <p className="artifact__exact">
        <span className="label">You countersign exactly</span>
        <Amount money={usd(offer.price, offer.rails[0])} size="lg" flight />
      </p>
      <dl className="fields">
        <div className="fields__wide">
          <dt className="label">Payee, locked</dt>
          <dd>
            <Hash value={offer.seller} label="payee address" copy={false} />
          </dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Offer hash</dt>
          <dd>
            <Hash value={listing.hash} head={10} tail={8} label="offer hash" copy={false} />
          </dd>
        </div>
      </dl>
      <HoldToSign
        key={round}
        ariaLabel={`Try the hold for ${offer.title}; nothing is bought`}
        left={listing.seller.name}
        right="you"
        onSigned={() => undefined}
      />
      <p className="artifact__note">
        A try-out: holding here buys nothing. An agent’s real purchase is signed with its own key.{" "}
        <button type="button" className="link-button" onClick={() => setRound((n) => n + 1)}>
          Clear it
        </button>
      </p>
    </figure>
  );
}

function ReleaseArtifact({ s, live }: { s: Settlement | undefined; live: boolean }) {
  if (!s) {
    return (
      <figure className="artifact artifact--empty">
        <figcaption className="artifact__head">
          <span className="label">Newest release</span>
        </figcaption>
        <p className="artifact__note">The first release on this hub lands here, with its transaction and its slip.</p>
      </figure>
    );
  }
  const template = explorerTemplate(s.network);
  const href = live ? (s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined)) : undefined;
  return (
    <figure className="artifact">
      <figcaption className="artifact__head">
        <span className="label">Newest release</span>
        {live ? null : <FixtureNote show />}
      </figcaption>
      <p className="artifact__exact">
        <span className="status status--settled">Settled</span>
        <Amount money={usd(s.amount, s.rail)} size="lg" />
      </p>
      <dl className="fields">
        <div className="fields__wide">
          <dt className="label">Offer</dt>
          <dd className="fields__word">{s.title || "Untitled offer"}</dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Transaction</dt>
          <dd>
            {href ? (
              <Hash value={s.tx} href={href} tx head={10} tail={8} label="transaction" />
            ) : (
              <Hash value={s.tx} head={10} tail={8} label="transaction" />
            )}
          </dd>
        </div>
        {s.slipHash ? (
          <div className="fields__wide">
            <dt className="label">Slip</dt>
            <dd>
              <Hash value={s.slipHash} head={10} tail={8} label="slip hash" />
            </dd>
          </div>
        ) : null}
      </dl>
      {s.slipHash ? (
        <Link to={`/slip/${s.slipHash}`} className="artifact__go">
          Check the slip without the hub
        </Link>
      ) : null}
    </figure>
  );
}
