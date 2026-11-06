import { useState } from "react";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { explorerTemplate, formatDay, formatTime, networkName, RAIL_LABEL, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { Listing, Settlement } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, CopyButton, FixtureNote, Hash, cx } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./home.css";

const REPO = "https://github.com/ss251/countersign";

/**
 * The front door. Never empty, never a redirect: what countersign is, what this hub has live,
 * how a purchase works beside a real offer, and the last money that moved.
 */
export default function HomePage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const rails = useResource(() => api.rails(), []);
  const settlements = useResource(() => api.settlements(6), []);

  const listed = (listings.data ?? []).filter((l) => l.status === "listed");
  const online = listed.filter((l) => l.online).length;
  const railCount = rails.data?.length ?? 0;
  const fixtures = [listings, rails, settlements].some((r) => r.source === "fixtures");
  const hub = hubBase();
  const hubUrl = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const discover = `bun packages/buyer/src/cli.ts discover --hub ${hubUrl}`;
  const featured = listed.find((l) => l.online) ?? listed[0];

  return (
    <div className="page home">
      <section className="home__lead" aria-labelledby="home-title">
        <p className="page__eyebrow home__eyebrow">
          Overview <FixtureNote show={fixtures} />
        </p>
        <h1 id="home-title" className="home__title">
          Checkout for software that sells itself.
        </h1>
        <p className="home__live num" aria-live="polite">
          {listings.error ? (
            "The hub did not answer, so its offers cannot be counted right now."
          ) : listings.loading && !listings.data ? (
            <span className="home__live-skeleton" aria-hidden="true" />
          ) : (
            <>
              <strong>{listed.length}</strong> {listed.length === 1 ? "offer" : "offers"} live on <strong>{railCount}</strong>{" "}
              {railCount === 1 ? "rail" : "rails"}, <strong>{online}</strong> with a runner online.{" "}
              {rails.data?.length ? <span className="home__rails">{rails.data.map((r) => RAIL_LABEL[r.id]).join(", ")}.</span> : null}
            </>
          )}
        </p>
        <nav className="home__quick" aria-label="Quick links">
          <a href={REPO} target="_blank" rel="noreferrer">
            Repository
          </a>
          <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">
            Docs
          </a>
          <Link to="/verify">Verify a slip</Link>
          <Link to="/seller/publish">Publish an offer</Link>
          <Link to="/assistant">Ask for a tool</Link>
        </nav>
        <div className="command home__command">
          <div className="command__head">
            <p className="field__label">List this hub’s offers from a terminal</p>
            <CopyButton value={discover} label="discover command" />
          </div>
          <pre className="command__body mono">{discover}</pre>
        </div>
      </section>

      <section className="how" aria-labelledby="how-title">
        <div className="how__steps">
          <h2 id="how-title" className="home__h2">
            How a purchase works
          </h2>
          <ol className="steps3">
            <li className="steps3__item">
              <span className="steps3__n num">1</span>
              <h3 className="steps3__name">The envelope approves</h3>
              <p className="steps3__body">
                You set a budget, a cap per seller and an allowlist. Your agent buys inside them on its own, and asks you above
                the amount you choose.
              </p>
            </li>
            <li className="steps3__item">
              <span className="steps3__n num">2</span>
              <h3 className="steps3__name">One countersignature</h3>
              <p className="steps3__body">
                The agent signs the offer hash and the exact amount. If anyone tries to settle at another price, the chain
                refuses it.
              </p>
            </li>
            <li className="steps3__item">
              <span className="steps3__n num">3</span>
              <h3 className="steps3__name">Release, or refund</h3>
              <p className="steps3__body">
                Output that matches the schema releases the money and mints a slip anyone can verify. Miss the deadline and
                anyone can refund. There is no dispute desk.
              </p>
            </li>
          </ol>
        </div>
        <Artifact listing={featured} />
      </section>

      <section className="home__block" aria-labelledby="settled-title">
        <h2 id="settled-title" className="home__h2">
          Latest settlements
        </h2>
        {settlements.error ? (
          <p className="home__note">The hub did not answer, so its settlements cannot be listed right now.</p>
        ) : settlements.loading && !settlements.data ? (
          <ul className="activity" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="activity__row activity__row--skeleton" />
            ))}
          </ul>
        ) : settlements.data === null ? (
          <p className="home__note">This hub does not list settlements yet. Each slip still links its own transaction.</p>
        ) : settlements.data && settlements.data.length === 0 ? (
          <p className="home__note">No money has moved on this hub yet. The first release appears here with its transaction.</p>
        ) : (
          <ul className="activity">
            {(settlements.data ?? []).map((s) => (
              <ActivityRow key={`${s.jobId}-${s.kind}`} s={s} live={settlements.source === "hub"} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Beside the steps: a real offer as the buyer would countersign it, or the example line. */
function Artifact({ listing }: { listing: Listing | undefined }) {
  const [round, setRound] = useState(0);
  if (!listing) {
    return (
      <figure className="artifact">
        <HoldToSign key={round} ariaLabel="Countersign the example offer" left="the offer" right="you" onSigned={() => undefined} />
        <figcaption className="artifact__caption">
          The ink stroke is the seller’s offer. Holding draws yours across the seam: the two together are the purchase.{" "}
          <button type="button" className="link-button" onClick={() => setRound((n) => n + 1)}>
            Clear it
          </button>
        </figcaption>
      </figure>
    );
  }
  const { offer } = listing;
  return (
    <figure className="artifact card">
      <p className="artifact__eyebrow">A live offer on this hub</p>
      <p className="artifact__title">
        <Link to={`/offer/${listing.hash}`}>{offer.title}</Link>
      </p>
      <p className="artifact__exact">
        You countersign exactly <Amount money={usd(offer.price, offer.rails[0])} size="lg" />
      </p>
      <p className="artifact__payee">
        Payee locked <Hash value={offer.seller} label="payee" copy={false} />
      </p>
      <HoldToSign
        key={round}
        ariaLabel={`Try the hold for ${offer.title}; nothing is bought`}
        left={listing.seller.name}
        right="you"
        onSigned={() => undefined}
      />
      <figcaption className="artifact__caption">
        A try-out: holding here buys nothing. An agent’s real purchase is signed with its own key.{" "}
        <button type="button" className="link-button" onClick={() => setRound((n) => n + 1)}>
          Clear it
        </button>
      </figcaption>
    </figure>
  );
}

function ActivityRow({ s, live }: { s: Settlement; live: boolean }) {
  const template = explorerTemplate(s.network);
  // Stand-in transactions are on no chain, so only live rows link out.
  const href = live ? (s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined)) : undefined;
  const word = s.kind === "released" ? "Released" : s.kind === "settled" ? "Settled" : "Refunded";
  const body = (
    <>
      <span className="activity__main">
        <span className="activity__title">{s.title}</span>
        <span className="activity__meta num">
          <span className={cx("status", s.kind === "refunded" ? "status--refunded" : "status--released")}>{word}</span> ·{" "}
          {RAIL_LABEL[s.rail]} · {networkName(s.network)} · {formatDay(s.at)}, {formatTime(s.at)}
        </span>
      </span>
      <Amount money={usd(s.amount, s.rail)} size="sm" className={s.kind === "refunded" ? "amount--void" : undefined} />
    </>
  );
  return (
    <li>
      {href ? (
        <a className="activity__row activity__row--link" href={href} target="_blank" rel="noreferrer" aria-label={`${s.title}, ${word}. Open the transaction.`}>
          {body}
        </a>
      ) : s.slipHash ? (
        <Link className="activity__row activity__row--link" to={`/slip/${s.slipHash}`}>
          {body}
        </Link>
      ) : (
        <div className="activity__row">{body}</div>
      )}
    </li>
  );
}
