import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { checkEnvelope } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, useResource, type Resource } from "../../lib/api.ts";
import { formatDuration, formatMoney, nowUnix, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { EnvelopeView, Listing } from "../../lib/types.ts";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, Button, CopyButton, FixtureNote, Hash, Tag, cx } from "../../ui/primitives.tsx";
import { rank, type Match } from "../buyer/assistant.ts";
import { buyCommand } from "../offer/index.tsx";
import "./assistant.css";

interface Answer {
  need: string;
  matches: Match[];
  /** Where the ranking ran: the hub's own search, or here over the hub's live offers. */
  by: "hub" | "here";
  ms: number;
  searched: number;
}

/**
 * Find a paid tool and countersign it inside your envelope. Every step shown is real work:
 * the search that ran, how long it took, and what the envelope said about each match.
 */
export function Assistant({ envelope, layout }: { envelope: Resource<EnvelopeView>; layout: "phone" | "desk" }) {
  const listings = useResource(() => api.listings(), []);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const all = listings.data ?? [];

  const ask = async (need: string) => {
    const text = need.trim();
    if (!text) return;
    setQuery(text);
    setBusy(true);
    setPicked(null);
    const t0 = performance.now();
    let found: Answer;
    try {
      const hub = await api.search(text);
      if (hub.data) {
        found = {
          need: text,
          by: "hub",
          ms: Math.round(performance.now() - t0),
          searched: all.length,
          matches: hub.data.map((r) => ({
            listing: { hash: r.offerHash as Listing["hash"], offer: r.offer, seller: { name: shortHex(r.offer.seller) }, status: "listed", online: r.online },
            score: r.score,
            why: r.why.map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}${/[.!?]$/.test(w) ? "" : "."}`),
          })),
        };
      } else {
        found = { need: text, by: "here", ms: Math.round(performance.now() - t0), searched: all.length, matches: rank(all, text) };
      }
    } catch {
      found = { need: text, by: "here", ms: Math.round(performance.now() - t0), searched: all.length, matches: rank(all, text) };
    }
    setAnswer(found);
    setBusy(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(query);
  };

  const view = envelope.data;
  const verdicts = useMemo(() => new Map((answer?.matches ?? []).map((m) => [m.listing.hash, verdictFor(m.listing, view)])), [answer, view]);
  const inside = [...verdicts.values()].filter((v) => v?.decision.ok).length;
  const chosen = answer?.matches.find((m) => m.listing.hash === picked);
  const examples = exampleNeeds(all);
  const fixtures = listings.source === "fixtures" || envelope.source === "fixtures";

  const form = (
    <form className={cx("ask__form", layout === "phone" && "ask__form--pinned")} onSubmit={submit} role="search">
      <label className={layout === "phone" ? "sr-only" : "ask__label"} htmlFor={inputId}>
        What does your agent need?
      </label>
      <div className="ask__row">
        <input
          ref={inputRef}
          id={inputId}
          className="input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="What does your agent need?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="primary" type="submit" disabled={!query.trim() || busy}>
          {busy ? "Finding" : "Find"}
        </Button>
      </div>
    </form>
  );

  const conversation = (
    <div className="ask__talk">
      {answer ? (
        <>
          <h1 className="ask__need">{answer.need}</h1>
          <details className="ask__steps">
            <summary>Assistant steps</summary>
            <ol>
              <li>
                {answer.by === "hub"
                  ? `Searched the hub’s live offers with its own search, in ${answer.ms} ms.`
                  : `Ranked the hub’s ${answer.searched} live ${answer.searched === 1 ? "offer" : "offers"} here, in ${answer.ms} ms. The hub has no search of its own yet.`}
              </li>
              <li>
                {answer.matches.length === 0
                  ? "Nothing fit, so nothing went to the envelope."
                  : `${answer.matches.length} fit. Checked each against your envelope: ${inside} inside, ${answer.matches.length - inside} refused.`}
              </li>
              <li>Nothing is signed until you hold to countersign, and the agent pays with its own key.</li>
            </ol>
          </details>
          {answer.matches.length === 0 ? (
            <div className="ask__fallback" role="status">
              <p className="ask__fallback-title">Nothing on this hub fits that yet.</p>
              <p>
                Try fewer or plainer words, or <Link to="/registry">browse every offer</Link>.
              </p>
            </div>
          ) : null}
          <div className="ask__chips" aria-label="Follow-ups">
            <button
              type="button"
              className="chip"
              onClick={() => {
                setAnswer(null);
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              Ask for something else
            </button>
            <Link to="/registry" className="chip">
              Browse every offer
            </Link>
          </div>
        </>
      ) : (
        <div className="ask__empty">
          <h1 className="ask__need">Find a paid tool and countersign it inside your envelope.</h1>
          <p className="ask__lede">
            Say what your agent needs. The assistant searches the hub’s live offers, says why each one fits, and checks it
            against your limits before you sign anything.
          </p>
          {examples.length ? (
            <div className="ask__chips" aria-label="Examples">
              {examples.map((x) => (
                <button key={x} type="button" className="chip" onClick={() => void ask(x)}>
                  {x}
                </button>
              ))}
            </div>
          ) : (
            <p className="ask__lede">This hub has no offers yet, so there is nothing to find.</p>
          )}
        </div>
      )}
    </div>
  );

  const results = answer && answer.matches.length ? (
    <section className="ask__results" aria-label="Matches">
      <p className="ask__count num" aria-live="polite">
        {answer.matches.length === 1 ? "1 offer fits" : `${answer.matches.length} offers fit`}, best first <FixtureNote show={fixtures} />
      </p>
      <ul className="matches">
        {answer.matches.map((m) => (
          <MatchCard
            key={m.listing.hash}
            m={m}
            verdict={verdicts.get(m.listing.hash) ?? null}
            picked={picked === m.listing.hash}
            onPick={() => setPicked(m.listing.hash)}
            onAllow={
              // The agent's signed mirror is read-only here: its allowlist changes on the agent's machine.
              view && !view.mirror
                ? () => {
                    const seller = m.listing.offer.seller.toLowerCase();
                    envelope.set({
                      ...view,
                      envelope: { ...view.envelope, allowlist: [...new Set([...view.envelope.allowlist, seller])] },
                      names: { ...view.names, [seller]: view.names[seller] ?? m.listing.seller.name },
                    });
                  }
                : undefined
            }
          />
        ))}
      </ul>
      {chosen && view ? <CountersignCard key={chosen.listing.hash} listing={chosen.listing} view={view} /> : null}
    </section>
  ) : null;

  if (layout === "desk") {
    return (
      <div className="ask ask--desk">
        <div className="ask__left">
          {form}
          {conversation}
        </div>
        <div className="ask__right">{results ?? <p className="ask__placeholder">Matches appear here, best first, each with the reason it fits.</p>}</div>
      </div>
    );
  }
  return (
    <div className="ask ask--phone">
      {conversation}
      {results}
      {form}
    </div>
  );
}

/** Three needs that hit real offers: one in plain words, two from the hub's own titles. */
function exampleNeeds(listings: Listing[]): string[] {
  const listed = listings.filter((l) => l.status === "listed");
  const out: string[] = [];
  if (listed.some((l) => /arc/i.test(l.offer.title + l.offer.summary))) out.push("deploy on arc");
  for (const l of listed) {
    if (out.length >= 3) break;
    const words = l.offer.title.replace(/[-_]+/g, " ").trim();
    if (!out.includes(words) && !(words.includes("arc") && out[0] === "deploy on arc")) out.push(words);
  }
  return out.slice(0, 3);
}

function verdictFor(listing: Listing, view: EnvelopeView | undefined) {
  if (!view) return null;
  const amount = listing.offer.price;
  const decision = checkEnvelope(view.envelope, view.spent, { seller: listing.offer.seller, offerHash: listing.hash, amount }, nowUnix());
  return { decision, asks: view.askAbove !== null && BigInt(amount) > BigInt(view.askAbove) };
}

function MatchCard({
  m,
  verdict,
  picked,
  onPick,
  onAllow,
}: {
  m: Match;
  verdict: ReturnType<typeof verdictFor>;
  picked: boolean;
  onPick: () => void;
  /** The way forward when the envelope refuses only because the seller is not on the allowlist. */
  onAllow?: () => void;
}) {
  const { offer } = m.listing;
  return (
    <li className={cx("match", picked && "is-picked")}>
      <div className="match__head">
        <p className="match__title">
          {offer.title} <Tag>{offer.adapter}</Tag>
        </p>
        <Amount money={usd(offer.price, offer.rails[0])} size="sm" />
      </div>
      <p className="match__meta">
        {m.listing.seller.name} · {RAIL_LABEL[offer.rails[0]!]}
        {m.listing.online ? " · runner online" : ""}
      </p>
      <p className="match__why">{m.why.join(" ")}</p>
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
      ) : verdict && !verdict.decision.ok && verdict.decision.reason === "not-allowlisted" && onAllow ? (
        <>
          <Button variant="secondary" block onClick={onAllow}>
            Allow this seller
          </Button>
          <p className="match__hint">Adds the seller to your envelope’s allowlist and checks again. Nothing is bought.</p>
        </>
      ) : verdict && !verdict.decision.ok && verdict.decision.reason === "not-allowlisted" ? (
        <p className="match__hint">Your allowlist lives on your agent’s machine. Add this seller there, and its next signed copy shows here.</p>
      ) : null}
    </li>
  );
}

/** The countersign card: exactly what the agent signs, the hold, then the call it makes. */
function CountersignCard({ listing, view }: { listing: Listing; view: EnvelopeView }) {
  const [signed, setSigned] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const { offer } = listing;
  const money = usd(offer.price, offer.rails[0]);
  const hub = hubBase();
  const base = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const command = buyCommand(listing.hash, offer.input, base);
  useEffect(() => ref.current?.scrollIntoView({ block: "nearest" }), []);
  return (
    <section ref={ref} className="cs-card" aria-labelledby="cs-card-title">
      <h2 id="cs-card-title" className="cs-card__title">
        Countersign card
      </h2>
      <p className="cs-card__exact">
        {view.agentName} countersigns exactly <Amount money={money} size="lg" flight />
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
      <HoldToSign ariaLabel={`Countersign ${formatMoney(money)} for ${offer.title}`} left={listing.seller.name} right="you" onSigned={() => setSigned(true)} />
      {signed ? (
        <div className="cs-card__next" role="status">
          <p className="cs-card__next-title">Countersigned for {view.agentName}.</p>
          <p className="cs-card__next-body">Your agent makes the paid call with its own key. Nothing has moved yet, and nothing moves at any other price.</p>
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
