import { useState } from "react";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { explorerTemplate, formatDay, formatTime, RAIL_LABEL, usd } from "../../lib/format.ts";
import type { Settlement } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, FixtureNote, Hash, RailTag, cx } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./home.css";

const REPO = "https://github.com/ss251/countersign";

/**
 * The front door. Never empty, never a redirect: what countersign is, what this hub has live,
 * the last money that moved, and how the envelope and the countersignature work.
 */
export default function HomePage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const rails = useResource(() => api.rails(), []);
  const settlements = useResource(() => api.settlements(6), []);
  const [round, setRound] = useState(0);

  const offers = listings.data ?? [];
  const listed = offers.filter((l) => l.status === "listed");
  const online = listed.filter((l) => l.online).length;
  const fixtures = [listings, rails, settlements].some((r) => r.source === "fixtures");

  return (
    <div className="page home">
      <section className="home__lead" aria-labelledby="home-title">
        <div className="home__thesis">
          <h1 id="home-title" className="home__title">
            Checkout for software that sells itself.
          </h1>
          <p className="home__lede">
            Agents buy calls to code, prompts and tools that sellers keep on their own machines. Each purchase is one
            countersignature over the offer and the amount, held in escrow until the output checks out.
          </p>
          <div className="button-row">
            <Link to="/buyer" className="btn btn--primary">
              Open the buyer’s phone
            </Link>
            <Link to="/registry" className="btn btn--secondary">
              Browse the registry
            </Link>
          </div>
        </div>

        <figure className="home__sign">
          <HoldToSign
            key={round}
            ariaLabel="Countersign the example offer"
            left="the offer"
            right="you"
            onSigned={() => undefined}
          />
          <figcaption className="home__sign-caption">
            The ink stroke is the seller’s offer. Holding draws yours across the seam: the two together are the purchase.{" "}
            <button type="button" className="link-button" onClick={() => setRound((n) => n + 1)}>
              Clear it
            </button>
          </figcaption>
        </figure>
      </section>

      <section className="live" aria-label="This hub, live">
        <div className="live__figure">
          {listings.error ? (
            <p className="live__count">The hub did not answer.</p>
          ) : (
            <p className="live__count num">
              <strong>{listed.length}</strong> {listed.length === 1 ? "offer" : "offers"} live
              {listed.length ? <span className="live__sub"> · {online} with a runner online</span> : null}
            </p>
          )}
          <FixtureNote show={fixtures} />
        </div>
        <div className="live__rails" aria-label="Rails">
          {(rails.data ?? []).map((r) => (
            <RailTag key={r.id} rail={r.id} />
          ))}
          {rails.data && rails.data.length === 0 ? <span className="live__sub">No rails declared yet.</span> : null}
        </div>
        {listed.length === 0 && !listings.error && !listings.loading ? (
          <p className="live__empty">
            No offers yet. A seller’s runner publishes one with a single command; <Link to="/seller/publish">here is how</Link>.
          </p>
        ) : null}
      </section>

      <section className="home__block" aria-labelledby="how-title">
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
      </section>

      <section className="home__block" aria-labelledby="settled-title">
        <h2 id="settled-title" className="home__h2">
          Latest settlements
        </h2>
        {settlements.error ? (
          <p className="home__note">The hub did not answer, so its settlements cannot be listed right now.</p>
        ) : settlements.data === null ? (
          <p className="home__note">This hub does not list settlements yet. Each slip still links its transaction.</p>
        ) : settlements.data && settlements.data.length === 0 ? (
          <p className="home__note">No money has moved on this hub yet. The first release will appear here with its transaction.</p>
        ) : (
          <ul className="settled">
            {(settlements.data ?? []).map((s) => (
              <SettlementRow key={`${s.jobId}-${s.kind}`} s={s} live={settlements.source === "hub"} />
            ))}
          </ul>
        )}
      </section>

      <footer className="home__links" aria-label="Source and documents">
        <a href={REPO} target="_blank" rel="noreferrer">
          Repository
        </a>
        <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
          README
        </a>
        <a href={`${REPO}/tree/main/docs/spec`} target="_blank" rel="noreferrer">
          Protocol spec
        </a>
        <a href={`${REPO}/blob/main/docs/deploy.md`} target="_blank" rel="noreferrer">
          Deploying
        </a>
        <Link to="/verify">Verify a slip</Link>
      </footer>
    </div>
  );
}

function SettlementRow({ s, live }: { s: Settlement; live: boolean }) {
  const template = explorerTemplate(s.network);
  // Stand-in transactions are on no chain, so only live rows link out.
  const href = live ? (s.explorer ?? (template && s.tx ? template.replace("{tx}", encodeURIComponent(s.tx)) : undefined)) : undefined;
  return (
    <li className="settled__row">
      <span className="settled__main">
        <span className="settled__title">
          {s.slipHash ? <Link to={`/slip/${s.slipHash}`}>{s.title}</Link> : s.title}
        </span>
        <span className="settled__meta num">
          {RAIL_LABEL[s.rail]} · {formatDay(s.at)}, {formatTime(s.at)}
        </span>
      </span>
      <span className="settled__end">
        <Amount money={usd(s.amount, s.rail)} size="sm" className={s.kind === "refunded" ? "amount--void" : undefined} />
        <span className={cx("status", s.kind === "refunded" ? "status--refunded" : "status--released")}>
          {s.kind === "released" ? "Released" : s.kind === "settled" ? "Settled" : "Refunded"}
        </span>
      </span>
      {s.tx ? (
        <span className="settled__tx">
          <Hash value={s.tx} head={8} tail={6} href={href} label="transaction" />
        </span>
      ) : null}
    </li>
  );
}
