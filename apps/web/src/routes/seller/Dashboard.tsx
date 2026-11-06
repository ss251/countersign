import { useId, useMemo } from "react";
import { Link, navigate } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDuration, formatTime, formatDay, shortHex, usd } from "../../lib/format.ts";
import type { Listing, Purchase } from "../../lib/types.ts";
import { Amount, Empty, FixtureNote, RailTag, Status, Tag, cx } from "../../ui/primitives.tsx";
import { releaseTotals } from "./logic.ts";

/**
 * A seller's desk: one seller at a time. What each offer charges and accepts, whether its
 * runner is connected, what it has released, and the latest sales with their slips.
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
          Check that it is running, or open this page without <span className="mono">?hub</span> to see fixtures.
        </Empty>
      </div>
    );
  }

  const offers = (listings.data ?? []).filter((l) => seller && l.offer.seller.toLowerCase() === seller.address);
  const sales = (purchases.data ?? []).filter((p) => seller && p.seller.address.toLowerCase() === seller.address);
  const totals = releaseTotals(sales);
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

      <div className="page__split seller__split">
        <section className="section" aria-labelledby="offers-title">
          <div className="seller__section-head">
            <h2 id="offers-title" className="section__title">
              Offers
            </h2>
            <p className="seller__count num">{offers.length === 1 ? "1 offer" : `${offers.length} offers`}</p>
          </div>
          {offers.length === 0 ? (
            <Empty title="Nothing published yet.">
              Publish a SKILL.md and it appears here with its price, its rails and every sale.{" "}
              <Link to="/seller/publish">Publish a skill</Link>
            </Empty>
          ) : (
            <ul className="offers">
              {offers.map((l) => (
                <OfferRow key={l.hash} listing={l} />
              ))}
            </ul>
          )}
        </section>

        <aside className="page__rail seller__rail" aria-label="Earnings">
          <section className="card seller__earned">
            <h2 className="section__title">Released to you</h2>
            {totals.length === 0 ? (
              <p className="seller__none">No releases yet. Money arrives here when a buyer's escrow releases.</p>
            ) : (
              <div className="seller__totals">
                {totals.map((t) => (
                  <Amount key={t.symbol} money={{ amount: t.atomic, asset: { symbol: t.symbol, decimals: 6 } }} size="lg" />
                ))}
              </div>
            )}
            <p className="seller__record num">
              {released} released · {refunded} refunded
            </p>
          </section>

          <section className="section" aria-labelledby="sales-title">
            <h2 id="sales-title" className="section__title">
              Latest sales
            </h2>
            {recent.length === 0 ? (
              <p className="seller__none">Each paid call lands here with its slip.</p>
            ) : (
              <ul className="sales">
                {recent.map((p) => (
                  <SaleRow key={p.jobId} p={p} />
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function OfferRow({ listing }: { listing: Listing }) {
  const { offer, stats, status, online, reason } = listing;
  const delisted = status === "delisted";
  return (
    <li className={cx("offer-row", delisted && "offer-row--delisted")}>
      <div className="offer-row__main">
        <p className="offer-row__title">
          <Link to={`/offer/${listing.hash}`}>{offer.title}</Link>
          <Tag>{offer.adapter}</Tag>
        </p>
        <p className="offer-row__summary">{offer.summary}</p>
        <p className="offer-row__rails">
          {offer.rails.map((r) => (
            <RailTag key={r} rail={r} />
          ))}
        </p>
      </div>
      <dl className="offer-row__facts">
        <div>
          <dt>Price</dt>
          <dd>
            <Amount money={usd(offer.price, offer.rails[0])} size="md" />
          </dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd className="num">{formatDuration(offer.deadline)}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd className="num">{stats ? `${stats.released} released · ${stats.refunded} refunded` : "No calls yet"}</dd>
        </div>
        <div>
          <dt>Runner</dt>
          <dd className={cx("offer-row__runner", online === false && "offer-row__runner--off")}>
            {delisted ? `Delisted${reason ? `: ${reason}` : ""}` : online === undefined ? "Not reported" : online ? "Online" : "Offline"}
          </dd>
        </div>
      </dl>
    </li>
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
