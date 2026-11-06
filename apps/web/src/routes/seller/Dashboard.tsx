import { useId, useMemo } from "react";
import { Link, navigate } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDay, formatTime, shortHex, symbolFor, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { Listing, Purchase } from "../../lib/types.ts";
import { Amount, CopyButton, Empty, FixtureNote, RailTag, Status, Tag, cx } from "../../ui/primitives.tsx";
import { absoluteHub, publishCommand, releaseTotals } from "./logic.ts";

/**
 * A seller’s desk, one seller at a time. Totals first, with the failures counted right beside
 * them; then each offer’s record in a table; then the latest sales with their slips.
 */
export function SellerDashboard({ query }: { query: URLSearchParams }) {
  const listings = useResource(() => api.listings(), []);
  const purchases = useResource(() => api.purchases(), []);
  const pickerId = useId();

  const sellers = useMemo(() => sellersOf(listings.data ?? []), [listings.data]);
  const asked = query.get("seller")?.toLowerCase();
  const seller = sellers.find((s) => s.address === asked) ?? sellers[0];
  const fixtures = listings.source === "fixtures" || purchases.source === "fixtures";

  if (listings.loading && !listings.data) return <div className="page" aria-busy="true" />;
  if (listings.error) {
    return (
      <div className="page">
        <Empty title="The hub did not answer.">
          Check that it is running, or open this page with <span className="mono">?hub=off</span> to see fixture data.
        </Empty>
      </div>
    );
  }

  const offers = (listings.data ?? []).filter((l) => seller && l.offer.seller.toLowerCase() === seller.address);
  const sales = (purchases.data ?? []).filter((p) => seller && p.seller.address.toLowerCase() === seller.address);
  const released = sales.filter((p) => p.status === "released").length;
  const refunded = sales.filter((p) => p.status === "refunded").length;
  const recent = [...sales].sort((a, b) => b.at - a.at).slice(0, 6);

  return (
    <div className="page seller">
      <header className="seller__head">
        <div className="seller__head-text">
          <p className="page__eyebrow">
            Seller <FixtureNote show={fixtures} />
          </p>
          <h1 className="page__title">{seller ? seller.name : "No sellers yet"}</h1>
          <p className="page__lede">Your code, prompts and keys stay on your machine. The hub only ever sees the schema and the price.</p>
        </div>
        <div className="seller__head-actions">
          {sellers.length > 1 ? (
            <div className="field seller__picker">
              <label className="field__label" htmlFor={pickerId}>
                Seller
              </label>
              <select
                id={pickerId}
                className="input"
                value={seller?.address ?? ""}
                onChange={(e) => navigate(`/seller?seller=${e.target.value}`)}
              >
                {sellers.map((s) => (
                  <option key={s.address} value={s.address}>
                    {s.name} · {shortHex(s.address)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Link to="/seller/publish" className="btn btn--primary">
            Publish a skill
          </Link>
        </div>
      </header>

      {offers.length === 0 ? (
        <FirstOffer />
      ) : (
        <>
          <section className="totals" aria-label="Totals">
            <div className="totals__money">
              {releaseTotals(sales).map((t) => (
                <Amount key={t.symbol} money={{ amount: t.atomic, asset: { symbol: t.symbol, decimals: 6 } }} size="xl" />
              ))}
              {released === 0 ? <Amount money={usd("0")} size="xl" /> : null}
              <span className="totals__label">released to you</span>
            </div>
            <p className="totals__line num">
              {plural(sales.length, "call")} · {released} released · {refunded} refunded · {rate(released, refunded)} delivered
            </p>
            <Sparkline sales={sales} />
          </section>

          <section className="section" aria-labelledby="offers-title">
            <h2 id="offers-title" className="section__title">
              Offers
            </h2>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th scope="col">Offer</th>
                  <th scope="col" className="is-num">Price</th>
                  <th scope="col" className="is-num">Calls</th>
                  <th scope="col" className="is-num">Earned</th>
                  <th scope="col" className="is-num">Refunded</th>
                  <th scope="col" className="is-num">Delivered</th>
                  <th scope="col">Runner</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((l) => (
                  <OfferRow key={l.hash} listing={l} sales={sales.filter((p) => p.offerHash === l.hash)} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="section seller__sales" aria-labelledby="sales-title">
            <h2 id="sales-title" className="section__title">
              Latest sales
            </h2>
            {recent.length === 0 ? (
              <p className="seller__quiet">No sales yet. Each paid call lands here with its slip.</p>
            ) : (
              <ul className="sales">
                {recent.map((p) => (
                  <SaleRow key={p.jobId} p={p} />
                ))}
              </ul>
            )}
            {refunded === 0 && released > 0 ? <p className="seller__quiet">No refunds. Every call so far delivered before its deadline.</p> : null}
          </section>
        </>
      )}
    </div>
  );
}

function OfferRow({ listing, sales }: { listing: Listing; sales: Purchase[] }) {
  const { offer, stats, status, online, reason } = listing;
  const released = stats?.released ?? sales.filter((p) => p.status === "released").length;
  const refunded = stats?.refunded ?? sales.filter((p) => p.status === "refunded").length;
  const calls = stats?.calls ?? sales.length;
  const earned = sales
    .filter((p) => p.status === "released")
    .reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const delisted = status === "delisted";
  return (
    <tr className={cx(delisted && "is-delisted")}>
      <th scope="row" className="ledger-table__offer">
        <span className="ledger-table__title">
          <Link to={`/offer/${listing.hash}`}>{offer.title}</Link>
          <Tag>{offer.adapter}</Tag>
        </span>
        <span className="ledger-table__rails">
          {offer.rails.map((r) => (
            <RailTag key={r} rail={r} />
          ))}
        </span>
      </th>
      <td className="is-num" data-label="Price">
        <Amount money={usd(offer.price, offer.rails[0])} size="sm" />
      </td>
      <td className="is-num num" data-label="Calls">
        {calls}
      </td>
      <td className="is-num" data-label="Earned">
        {earned > 0n ? <Amount money={usd(earned, offer.rails[0])} size="sm" /> : <span className="ledger-table__none">—</span>}
      </td>
      <td className="is-num num" data-label="Refunded">
        {refunded}
      </td>
      <td className="is-num num" data-label="Delivered">
        {rate(released, refunded)}
      </td>
      <td data-label="Runner" className={cx("ledger-table__runner", online === false && "is-off")}>
        {delisted ? `Delisted${reason ? `: ${reason}` : ""}` : online === undefined ? "—" : online ? "Online" : "Offline"}
      </td>
    </tr>
  );
}

/** Calls per hour over the last day. A count, so ink, never blue. */
function Sparkline({ sales }: { sales: Purchase[] }) {
  const now = Math.floor(Date.now() / 1000);
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const p of sales) {
    const h = Math.floor((now - p.at) / 3600);
    if (h >= 0 && h < 24) buckets[23 - h]! += 1;
  }
  const total = buckets.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...buckets);
  const w = 240;
  const hgt = 32;
  const step = w / (buckets.length - 1);
  const points = buckets.map((v, i) => `${(i * step).toFixed(1)},${(hgt - 2 - (v / max) * (hgt - 4)).toFixed(1)}`).join(" ");
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${w} ${hgt}`} width={w} height={hgt} role="img" aria-label={`${plural(total, "call")} in the last 24 hours`}>
        <line x1="0" x2={w} y1={hgt - 2} y2={hgt - 2} className="spark__base" />
        <polyline points={points} className="spark__line" />
      </svg>
      <figcaption className="spark__caption num">{plural(total, "call")} in the last 24 hours</figcaption>
    </figure>
  );
}

function SaleRow({ p }: { p: Purchase }) {
  const body = (
    <>
      <span className="sale__main">
        <span className="sale__title">{p.title}</span>
        <span className="sale__when num">
          {formatDay(p.at)}, {formatTime(p.at)}
        </span>
      </span>
      <span className="sale__end">
        <Amount money={usd(p.amount, p.rail)} size="sm" className={p.status === "released" ? undefined : "amount--void"} />
        <Status status={p.status} />
      </span>
    </>
  );
  return (
    <li>
      {p.slipHash ? (
        <Link to={`/slip/${p.slipHash}`} className="sale sale--link">
          {body}
        </Link>
      ) : (
        <div className="sale">{body}</div>
      )}
    </li>
  );
}

/** The empty desk teaches the next step with the real command. */
function FirstOffer() {
  const command = publishCommand({
    hub: absoluteHub(hubBase(), window.location.origin),
    price: "20000",
    deadline: 120,
    rails: ["escrow"],
  });
  return (
    <section className="first-offer" aria-labelledby="first-title">
      <h2 id="first-title" className="first-offer__title">
        No calls yet. Publish your first offer.
      </h2>
      <p className="first-offer__body">
        From the repository root, beside your SKILL.md, with your key in <span className="mono">CS_SELLER_KEY</span>:
      </p>
      <div className="command">
        <div className="command__head">
          <p className="field__label">Publish at 0.02 {symbolFor("escrow")} a call</p>
          <CopyButton value={command} label="publish command" />
        </div>
        <pre className="command__body mono">{command}</pre>
      </div>
      <p className="first-offer__body">
        Or <Link to="/seller/publish">build the terms step by step</Link>.
      </p>
    </section>
  );
}

function rate(released: number, refunded: number): string {
  const n = released + refunded;
  return n === 0 ? "—" : `${Math.round((released / n) * 100)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

interface SellerRef {
  address: string;
  name: string;
}

function sellersOf(listings: Listing[]): SellerRef[] {
  const seen = new Map<string, SellerRef>();
  for (const l of listings) {
    const address = l.offer.seller.toLowerCase();
    if (!seen.has(address)) seen.set(address, { address, name: l.seller.name });
  }
  return [...seen.values()];
}

