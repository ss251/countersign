import { useEffect, useState } from "react";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDateTime, formatDuration, usd } from "../../lib/format.ts";
import type { Listing, Purchase } from "../../lib/types.ts";
import { Amount, Button, Card, cx, Empty, FixtureNote, RailTag, Status, Tag } from "../../ui/primitives.tsx";
import { releaseTotals, type ReleaseTotal } from "./logic.ts";

/** The seller's own desk: what each offer has done, and what it has earned. */
export function SellerDashboard({ query }: { query: URLSearchParams }) {
  const listings = useResource(() => api.listings(), []);
  const purchases = useResource(() => api.purchases(), []);
  const fromQuery = query.get("seller") ?? "";
  const [filter, setFilter] = useState(fromQuery);

  useEffect(() => {
    setFilter(fromQuery);
  }, [fromQuery]);

  if (listings.loading && !listings.data) return <div className="page" aria-busy="true" />;
  if (listings.error && !listings.data) {
    return (
      <div className="page">
        <Empty title="The offers could not be read.">
          <Button variant="secondary" onClick={listings.reload}>
            Try again
          </Button>
        </Empty>
      </div>
    );
  }

  const all = listings.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle ? all.filter((listing) => listing.offer.seller.toLowerCase() === needle) : all;
  const sales = (purchases.data ?? []).filter(
    (purchase) => !needle || purchase.seller.address.toLowerCase() === needle,
  );
  const recent = [...sales].sort((a, b) => b.at - a.at).slice(0, 5);
  const totals = releaseTotals(sales);
  const fixtures = listings.source === "fixtures" || purchases.source === "fixtures";
  const groups = groupBySeller(visible);

  return (
    <div className="page">
      <header className="page__head seller__head">
        <div className="seller__head-row">
          <p className="page__eyebrow">Seller</p>
          <FixtureNote show={fixtures} />
        </div>
        <div className="seller__head-row">
          <h1 className="page__title">Your offers</h1>
          <Link to="/seller/publish" className="btn btn--primary">
            Publish a skill
          </Link>
        </div>
        <p className="page__lede">Code, prompts and keys stay on your machine. Only the schema and the price are published.</p>
      </header>

      <div className="field seller__filter">
        <label className="field__label" htmlFor="seller-address">
          Seller address
        </label>
        <input
          id="seller-address"
          className="input mono"
          type="text"
          value={filter}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="seller-address-hint"
          onChange={(event) => setFilter(event.target.value)}
        />
        <p id="seller-address-hint" className="seller__hint">
          Leave it empty to show every seller.
        </p>
      </div>

      <div className="page__split">
        <section className="section" aria-labelledby="offers-title">
          <h2 id="offers-title" className="section__title">
            Offers
          </h2>
          {visible.length === 0 ? (
            <Empty title={needle ? "No offers from this address." : "No offers yet."}>
              <Link to="/seller/publish">Publish a skill</Link>
            </Empty>
          ) : (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th scope="col">Offer</th>
                    <th scope="col">Price</th>
                    <th scope="col">Rails</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Runner</th>
                    <th scope="col" className="seller-table__count">
                      Released
                    </th>
                    <th scope="col" className="seller-table__count">
                      Refunded
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                {groups.map((group) => (
                  <tbody key={group.name}>
                    {needle ? null : (
                      <tr className="seller-table__group">
                        <th scope="colgroup" colSpan={8}>
                          {group.name}
                        </th>
                      </tr>
                    )}
                    {group.listings.map((listing) => (
                      <OfferRow key={listing.hash} listing={listing} />
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>

        <aside className="page__rail" aria-label="Earnings">
          <Card className="seller-earn">
            <h2 className="section__title">Earned</h2>
            {totals.length > 0 ? (
              <div className="seller-earn__totals">
                {totals.map((total) => (
                  <Amount key={total.symbol} money={moneyFor(total)} size="lg" />
                ))}
              </div>
            ) : (
              <p className="seller-muted">Nothing released yet.</p>
            )}
            <dl className="seller-counts">
              <div>
                <dt>Released</dt>
                <dd className="num">{count(sales, "released")}</dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd className="num">{count(sales, "refunded")}</dd>
              </div>
            </dl>
          </Card>

          <Card className="seller-recent">
            <h2 className="section__title">Recent sales</h2>
            {purchases.error ? (
              <p className="seller-muted">Recent sales could not be read.</p>
            ) : recent.length === 0 ? (
              <p className="seller-muted">No sales yet.</p>
            ) : (
              <ul className="seller-sales">
                {recent.map((purchase) => (
                  <li key={purchase.jobId}>
                    <SaleRow purchase={purchase} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function OfferRow({ listing }: { listing: Listing }) {
  const offer = listing.offer;
  return (
    <tr>
      <td>
        <span className="seller-offer">
          <Link to={`/offer/${listing.hash}`} className="seller-offer__title">
            {offer.title}
          </Link>
          <Tag>{offer.adapter}</Tag>
        </span>
      </td>
      <td>
        <Amount money={usd(offer.price, offer.rails[0])} size="sm" />
      </td>
      <td>
        <span className="seller-rail-list">
          {offer.rails.map((rail) => (
            <RailTag key={rail} rail={rail} />
          ))}
        </span>
      </td>
      <td className="num">{formatDuration(offer.deadline)}</td>
      <td>
        <span className={cx("seller-runner", listing.online ? "seller-runner--online" : "seller-runner--offline")}>
          {listing.online ? "Online" : "Offline"}
        </span>
      </td>
      <td className="num seller-table__count">{listing.stats ? listing.stats.released : "—"}</td>
      <td className="num seller-table__count">{listing.stats ? listing.stats.refunded : "—"}</td>
      <td>
        {listing.status === "listed" ? (
          <span className="seller-state seller-state--listed">listed</span>
        ) : (
          <span className="seller-state seller-state--delisted">
            delisted
            {listing.reason ? <span className="seller-state__reason"> · {listing.reason}</span> : null}
          </span>
        )}
      </td>
    </tr>
  );
}

function SaleRow({ purchase }: { purchase: Purchase }) {
  const body = (
    <>
      <span className="seller-sale__main">
        <span className="seller-sale__title">{purchase.title}</span>
        <span className="seller-sale__time">{formatDateTime(purchase.at)}</span>
      </span>
      <span className="seller-sale__end">
        <Amount money={usd(purchase.amount, purchase.rail)} size="sm" />
        <Status status={purchase.status} />
      </span>
    </>
  );
  return purchase.slipHash ? (
    <Link to={`/slip/${purchase.slipHash}`} className="seller-sale seller-sale--link">
      {body}
    </Link>
  ) : (
    <div className="seller-sale">{body}</div>
  );
}

function moneyFor(total: ReleaseTotal) {
  return usd(total.atomic, total.symbol === "USDT" ? "whitechain" : "escrow");
}

function count(purchases: Purchase[], status: Purchase["status"]): number {
  return purchases.filter((purchase) => purchase.status === status).length;
}

function groupBySeller(listings: Listing[]): Array<{ name: string; listings: Listing[] }> {
  const groups = new Map<string, Listing[]>();
  for (const listing of listings) {
    const group = groups.get(listing.seller.name);
    if (group) group.push(listing);
    else groups.set(listing.seller.name, [listing]);
  }
  return [...groups].map(([name, items]) => ({ name, listings: items }));
}
