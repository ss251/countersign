import { useState } from "react";
import { Link } from "../../app/router.tsx";
import { envelopeChecklist } from "../../lib/checklist.ts";
import { explorerTemplate, formatClock, usd } from "../../lib/format.ts";
import type { EnvelopeView, Listing, Settlement } from "../../lib/types.ts";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, FixtureNote, Hash } from "../../ui/primitives.tsx";
import "./home.css";

/**
 * How a purchase clears, in three steps, each beside a real artifact from this hub: the agent's
 * signed envelope (or a labelled example until the hub serves one), a live offer to countersign,
 * and the newest release.
 */
export function ClearSteps({
  envelope,
  featured,
  newest,
  settled,
}: {
  envelope: { data: EnvelopeView | null | undefined; source: string | undefined; reason: string | undefined };
  featured: Listing | undefined;
  newest: Settlement | undefined;
  settled: boolean;
}) {
  return (
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
            absent={envelope.source === "absent"}
            listing={featured}
          />
        </li>
        <li className="clear__step">
          <p className="clear__n mono">02</p>
          <h3 className="clear__name">Countersignature</h3>
          <p className="clear__body">
            Above that amount, your agent waits for you to approve the exact offer and price. A settlement at any other amount
            is refused: by the escrow contract on Arc, by the rail’s own check on Hedera and Gateway.
          </p>
          <CountersignArtifact listing={featured} />
        </li>
        <li className="clear__step">
          <p className="clear__n mono">03</p>
          <h3 className="clear__name">Release</h3>
          <p className="clear__body">
            On the escrow rails, output that matches the schema releases the escrow and mints a slip anyone can verify without
            the hub, and a missed deadline lets anyone refund. Hedera and Gateway settle before delivery.
          </p>
          <ReleaseArtifact s={newest} live={settled} />
        </li>
      </ol>
  );
}

/* The three artifacts the steps point at. Each is real data from this hub, or says it is an example. */

function EnvelopeArtifact({
  view,
  live,
  absent,
  listing,
}: {
  view: EnvelopeView | undefined;
  live: boolean;
  /** The hub has no agent's envelope to show, so the example stands in, plainly labelled. */
  absent: boolean;
  listing: Listing | undefined;
}) {
  if (absent) return <ExampleEnvelope />;
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
          <dt className="label">Cap per seller</dt>
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

/*
 * What an envelope holds, until an agent's own is served here: the four fields, their values in
 * words. No amount, no agent and no signing time, so it can never be read as a record; the real
 * envelope takes its place, field for field, as soon as the hub serves one.
 */
function ExampleEnvelope() {
  return (
    <figure className="artifact">
      <figcaption className="artifact__head">
        <span className="label">Example envelope</span>
      </figcaption>
      <dl className="fields">
        <div className="fields__wide">
          <dt className="label">Budget</dt>
          <dd className="fields__word">The most it spends in all</dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Cap per seller</dt>
          <dd className="fields__word">The most any one seller gets</dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Allowlist</dt>
          <dd className="fields__word">Only the sellers you name</dd>
        </div>
        <div className="fields__wide">
          <dt className="label">Ask above</dt>
          <dd className="fields__word">Above this price, it asks you first</dd>
        </div>
      </dl>
    </figure>
  );
}

function CountersignArtifact({ listing }: { listing: Listing | undefined }) {
  const [round, setRound] = useState(0);
  if (!listing) return <div className="artifact artifact--skeleton" aria-hidden="true" />;
  const { offer } = listing;
  // The payee on the rail this card prices: payTo when the offer names one (a Hedera account), else the seller's key.
  const rail = offer.rails[0];
  const payee = (rail && offer.payTo?.[rail]) || offer.seller;
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
          <dt className="label">Payee</dt>
          <dd>
            <Hash value={payee} label="payee" copy={false} />
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
        <Link to={`/verify/${s.slipHash}`} className="artifact__go">
          Check the slip without the hub
        </Link>
      ) : null}
    </figure>
  );
}
