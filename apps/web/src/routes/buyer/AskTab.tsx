import { useId, useMemo, useState, type FormEvent } from "react";
import { checkEnvelope } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, useResource, type Resource } from "../../lib/api.ts";
import { formatDuration, formatMoney, nowUnix, RAIL_LABEL, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { EnvelopeView, Listing } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, CopyButton, Hash, Tag, cx } from "../../ui/primitives.tsx";
import { buyCommand } from "../offer/index.tsx";
import { rank, type Match } from "./assistant.ts";

/**
 * Ask in plain words, get the live offers that fit and why, see what the envelope says about
 * each, and countersign the one you want. The browser holds no keys: the card hands the agent
 * the exact call to make.
 */
export function AskTab({ envelope }: { envelope: Resource<EnvelopeView> }) {
  const listings = useResource(() => api.listings(), []);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const inputId = useId();

  const all = listings.data ?? [];
  const matches = useMemo(() => (asked ? rank(all, asked) : []), [all, asked]);
  const suggestions = all.filter((l) => l.status === "listed").slice(0, 3);
  const chosen = matches.find((m) => m.listing.hash === picked);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAsked(query.trim());
    setPicked(null);
  };

  return (
    <div className="ask">
      <form className="ask__form" onSubmit={submit} role="search">
        <label className="ask__label" htmlFor={inputId}>
          What does your agent need?
        </label>
        <div className="ask__row">
          <input
            id={inputId}
            className="input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Deploy a contract on Arc"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="primary" type="submit" disabled={!query.trim()}>
            Find
          </Button>
        </div>
        {suggestions.length && !asked ? (
          <p className="ask__try">
            On this hub now:{" "}
            {suggestions.map((l, i) => (
              <span key={l.hash}>
                {i ? ", " : ""}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setQuery(l.offer.title);
                    setAsked(l.offer.title);
                    setPicked(null);
                  }}
                >
                  {l.offer.title}
                </button>
              </span>
            ))}
          </p>
        ) : null}
      </form>

      {listings.error ? (
        <p className="ask__fallback">The hub did not answer, so there is nothing to search right now.</p>
      ) : asked && matches.length === 0 ? (
        <div className="ask__fallback" role="status">
          <p className="ask__fallback-title">Nothing on this hub fits “{asked}”.</p>
          <p>
            Try fewer or plainer words, or <Link to="/registry">browse every offer</Link>. Nothing is bought until you
            countersign.
          </p>
        </div>
      ) : null}

      {matches.length ? (
        <section aria-label="Matches">
          <p className="ask__count num" aria-live="polite">
            {matches.length === 1 ? "1 offer fits" : `${matches.length} offers fit`}, best first
          </p>
          <ul className="matches">
            {matches.map((m) => (
              <MatchCard
                key={m.listing.hash}
                m={m}
                view={envelope.data}
                picked={picked === m.listing.hash}
                onPick={() => setPicked(m.listing.hash)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {chosen && envelope.data ? <CountersignCard key={chosen.listing.hash} listing={chosen.listing} view={envelope.data} /> : null}
    </div>
  );
}

function verdictFor(listing: Listing, view: EnvelopeView | undefined) {
  if (!view) return null;
  const amount = listing.offer.price;
  const decision = checkEnvelope(view.envelope, view.spent, { seller: listing.offer.seller, offerHash: listing.hash, amount }, nowUnix());
  const asks = BigInt(amount) > BigInt(view.askAbove);
  return { decision, asks };
}

function MatchCard({ m, view, picked, onPick }: { m: Match; view: EnvelopeView | undefined; picked: boolean; onPick: () => void }) {
  const { offer } = m.listing;
  const verdict = verdictFor(m.listing, view);
  return (
    <li className={cx("match", picked && "is-picked")}>
      <div className="match__head">
        <p className="match__title">
          {offer.title} <Tag>{offer.adapter}</Tag>
        </p>
        <Amount money={usd(offer.price, offer.rails[0])} size="sm" />
      </div>
      <ul className="match__why">
        {m.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {verdict ? (
        <p className={cx("match__verdict", !verdict.decision.ok && "is-refused")}>
          {!verdict.decision.ok
            ? verdict.decision.message
            : verdict.asks
              ? "Inside your envelope. Above your ask limit, so it needs your countersignature."
              : "Inside your envelope. Your agent can buy this on its own."}
        </p>
      ) : null}
      {verdict?.decision.ok ? (
        <Button variant="secondary" block onClick={onPick} aria-pressed={picked}>
          {picked ? "Chosen" : `Choose ${offer.title}`}
        </Button>
      ) : null}
    </li>
  );
}

/** The countersign card: exactly what the agent will sign, then the hold, then the call it makes. */
function CountersignCard({ listing, view }: { listing: Listing; view: EnvelopeView }) {
  const [signed, setSigned] = useState(false);
  const { offer } = listing;
  const money = usd(offer.price, offer.rails[0]);
  const hub = hubBase();
  const base = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const command = buyCommand(listing.hash, offer.input, base);
  return (
    <section className="cs-card" aria-labelledby="cs-card-title">
      <h2 id="cs-card-title" className="cs-card__title">
        Countersign card
      </h2>
      <p className="cs-card__exact">
        {view.agentName} countersigns exactly <Amount money={money} size="lg" />
      </p>
      <dl className="cs-card__terms">
        <div>
          <dt>Offer</dt>
          <dd>
            {offer.title} <Hash value={listing.hash} label="offer hash" copy={false} />
          </dd>
        </div>
        <div>
          <dt>Payee locked</dt>
          <dd>
            <Hash value={offer.seller} label="payee" copy={false} />
          </dd>
        </div>
        <div>
          <dt>Rail</dt>
          <dd>{RAIL_LABEL[offer.rails[0]!]}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd className="num">{formatDuration(offer.deadline)}, then anyone can refund</dd>
        </div>
      </dl>
      <HoldToSign
        ariaLabel={`Countersign ${formatMoney(money)} for ${offer.title}`}
        left={listing.seller.name}
        right="you"
        onSigned={() => setSigned(true)}
      />
      {signed ? (
        <div className="cs-card__next" role="status">
          <p className="cs-card__next-title">Countersigned for {view.agentName}.</p>
          <p className="cs-card__next-body">
            Your agent makes the paid call with its own key. Nothing has moved yet, and nothing moves at any other price.
          </p>
          <div className="command">
            <div className="command__head">
              <p className="field__label">The call it makes</p>
              <CopyButton value={command} label="buy command" />
            </div>
            <pre className="command__body mono">{command}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
