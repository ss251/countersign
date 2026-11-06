import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { checkEnvelope } from "@countersign/core";
import { Link } from "../../app/router.tsx";
import { api, useResource, type Resource } from "../../lib/api.ts";
import { envelopeChecklist } from "../../lib/checklist.ts";
import { formatDuration, formatMoney, nowUnix, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { EnvelopeView, Listing } from "../../lib/types.ts";
import { AddressGlyph } from "../../ui/AddressGlyph.tsx";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { Amount, CopyButton, FixtureNote, Hash, Tag, cx } from "../../ui/primitives.tsx";
import { rank, type Match } from "../buyer/assistant.ts";
import { buyCommand } from "../offer/index.tsx";
import { exampleNeeds, groupMatches, modKey, plainReason, selectable, type Verdict } from "./palette.ts";
import "./assistant.css";

interface Answer {
  need: string;
  matches: Match[];
  /** Where the ranking ran: the hub's own search, or here over the hub's live offers. */
  by: "hub" | "here";
  ms: number;
  searched: number;
}

const HINT_KEY = "countersign.palette-hint";

/**
 * A command palette for paid tools. One mono input; matches grouped by what your envelope says
 * about them; one plain reason per row. ↑ and ↓ move, Enter opens the purchase card, Esc closes.
 * Every step shown is real work: the search that ran and the envelope check over each match.
 */
export function Assistant({
  envelope,
  layout,
  initialQuery = "",
  initialPick,
  onOpen,
}: {
  envelope: Resource<EnvelopeView | null>;
  layout: "page" | "phone" | "overlay";
  initialQuery?: string;
  initialPick?: string;
  /** In the ⌘K overlay, Enter hands the query and the chosen offer to the assistant's page. */
  onOpen?: (query: string, hash: string) => void;
}) {
  const listings = useResource(() => api.listings(), []);
  const [query, setQuery] = useState(initialQuery);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(initialPick ?? null);
  const [hint, setHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const asked = useRef(0);
  const inputId = useId();
  const listId = useId();
  const all = listings.data ?? [];
  // Undefined while loading or when the hub holds no envelope for the agent: matches are then unchecked here.
  const view = envelope.data ?? undefined;
  const noEnvelope = envelope.source === "absent";

  const ask = async (need: string) => {
    const text = need.trim();
    const n = ++asked.current;
    if (!text) {
      setAnswer(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t0 = performance.now();
    let found: Answer;
    try {
      const hub = await api.search(text, 8);
      found = hub.data
        ? {
            need: text,
            by: "hub",
            ms: Math.round(performance.now() - t0),
            searched: all.length,
            matches: hub.data.map((r) => ({
              listing: {
                hash: r.offerHash as Listing["hash"],
                offer: r.offer,
                seller: { name: shortHex(r.offer.seller), named: false },
                status: "listed",
                online: r.online,
              },
              score: r.score,
              why: r.why,
            })),
          }
        : { need: text, by: "here", ms: Math.round(performance.now() - t0), searched: all.length, matches: rank(all, text, 8) };
    } catch {
      found = { need: text, by: "here", ms: Math.round(performance.now() - t0), searched: all.length, matches: rank(all, text, 8) };
    }
    // A slower, older answer never replaces a newer one.
    if (n !== asked.current) return;
    setAnswer(found);
    setActive(0);
    setBusy(false);
    if (layout === "page") {
      try {
        if (!window.localStorage.getItem(HINT_KEY)) {
          window.localStorage.setItem(HINT_KEY, "1");
          setHint(true);
        }
      } catch {
        // Private mode: the hint simply does not show.
      }
    }
  };

  // Search as the person types, once they pause; Enter searches at once.
  useEffect(() => {
    const id = window.setTimeout(() => void ask(query), 180);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, listings.data]);

  const verdicts = useMemo(() => new Map((answer?.matches ?? []).map((m) => [m.listing.hash, verdictFor(m.listing, view)])), [answer, view]);
  const groups = groupMatches(answer?.matches ?? [], (m) => verdicts.get(m.listing.hash) ?? null);
  const rows = selectable(groups);
  const current = rows.length ? rows[Math.min(active, rows.length - 1)] : undefined;
  const chosen = answer?.matches.find((m) => m.listing.hash === picked);
  const examples = exampleNeeds(all);
  const fixtures = listings.source === "fixtures" || envelope.source === "fixtures";
  const checked = [...verdicts.values()].filter(Boolean).length;
  const refused = groups.find((g) => g.id === "refused")?.rows.length ?? 0;

  const open = (m: Match) => {
    if (onOpen) onOpen(query.trim(), m.listing.hash);
    else setPicked(m.listing.hash);
  };

  // Keep the selected row in view as the arrows move it. No animation: keyboard moves are instant.
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector(`[data-hash="${current.listing.hash}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // The page answers ⌘K by focusing its own input instead of opening a second palette.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("countersign:palette", focus);
    return () => window.removeEventListener("countersign:palette", focus);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)));
    } else if (e.key === "Escape" && layout !== "overlay" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (answer && answer.need === query.trim() && current) open(current);
    else void ask(query);
  };

  const allow = (m: Match) => {
    if (!view || view.mirror) return undefined;
    return () => {
      const seller = m.listing.offer.seller.toLowerCase();
      envelope.set({
        ...view,
        envelope: { ...view.envelope, allowlist: [...new Set([...view.envelope.allowlist, seller])] },
        names: { ...view.names, [seller]: view.names[seller] ?? m.listing.seller.name },
      });
    };
  };

  const palette = (
    <div className={cx("palette", `palette--${layout}`)}>
      <form className="palette__form" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor={inputId}>
          What does your agent need?
        </label>
        <svg className="palette__glass" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          className="palette__input"
          type="search"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-activedescendant={current ? `${listId}-${current.listing.hash}` : undefined}
          aria-autocomplete="list"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          // A finger opens the keyboard itself; a keyboard user expects the caret already there.
          autoFocus={layout !== "phone" && window.matchMedia("(pointer: fine)").matches}
          placeholder="What does your agent need?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? <span className="palette__busy" aria-hidden="true" /> : null}
      </form>

      {answer ? (
        <div className="palette__body">
          <details className="palette__steps">
            <summary className="num">
              {answer.by === "hub" ? `Searched the hub in ${answer.ms} ms` : `Ranked ${answer.searched} offers here in ${answer.ms} ms`}
              {answer.matches.length ? (noEnvelope ? " · not checked: your envelope is not on this hub" : ` · checked ${checked} against your envelope`) : ""}{" "}
              <FixtureNote show={fixtures} />
            </summary>
            <ol>
              <li>
                {answer.by === "hub"
                  ? `The hub’s own search ranked its live offers for “${answer.need}”.`
                  : `This hub has no search of its own, so its ${answer.searched} live offers were ranked here for “${answer.need}”.`}
              </li>
              <li>
                {answer.matches.length === 0
                  ? "Nothing matched, so nothing reached the envelope."
                  : noEnvelope
                    ? `${envelope.reason ?? "Your envelope is not on this hub."} So the matches were not checked against it here; your agent checks its own envelope before it pays.`
                    : `Each match was checked against your envelope: ${answer.matches.length - refused} inside, ${refused} refused.`}
              </li>
              <li>Nothing is signed until you hold to countersign, and the agent pays with its own key.</li>
            </ol>
          </details>

          {answer.matches.length === 0 ? (
            <div className="palette__none" role="status">
              <p className="palette__none-title">Nothing on this hub fits “{answer.need}”.</p>
              <p>
                Try fewer or plainer words, or <Link to="/registry">browse every offer</Link>.
              </p>
            </div>
          ) : (
            <div ref={listRef} id={listId} className="palette__list" role="listbox" aria-label="Matches">
              {groups.map((g) => (
                <div key={g.id} role="group" aria-labelledby={`${listId}-${g.id}`} className={cx("pgroup", `pgroup--${g.id}`)}>
                  <p id={`${listId}-${g.id}`} className="pgroup__label label" role="presentation">
                    {g.label}
                  </p>
                  {g.rows.map((m) => (
                    <Row
                      key={m.listing.hash}
                      id={`${listId}-${m.listing.hash}`}
                      m={m}
                      verdict={verdicts.get(m.listing.hash) ?? null}
                      active={current?.listing.hash === m.listing.hash}
                      picked={picked === m.listing.hash}
                      onHover={() => {
                        const i = rows.findIndex((r) => r.listing.hash === m.listing.hash);
                        if (i >= 0) setActive(i);
                      }}
                      onOpen={() => open(m)}
                      onAllow={allow(m)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {layout === "overlay" ? (
            <p className="palette__keys" aria-hidden="true">
              <kbd>↑</kbd>
              <kbd>↓</kbd> move <kbd>↵</kbd> open <kbd>esc</kbd> close
            </p>
          ) : null}
        </div>
      ) : (
        <div className="palette__body">
          {examples.length ? (
            <>
              <p className="label palette__try">Try one of these. Each finds a live offer.</p>
              <ul className="palette__examples">
                {examples.map((x) => (
                  <li key={x.need}>
                    <button type="button" className="example" onClick={() => setQuery(x.need)}>
                      <span className="example__need mono">{x.need}</span>
                      <span className="example__hits">finds {x.hits.offer.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="palette__try">{listings.loading ? "Reading the hub’s offers…" : "This hub has no offers yet, so there is nothing to find."}</p>
          )}
        </div>
      )}
    </div>
  );

  if (layout === "overlay") return palette;

  return (
    <div className={cx("ask", `ask--${layout}`)}>
      <div className="ask__palette">
        {layout === "page" ? (
          <header className="ask__head">
            <p className="page__eyebrow">Assistant</p>
            <h1 className="page__title">Find a paid tool and countersign it inside your envelope.</h1>
            {hint ? (
              <p className="ask__hint" role="status">
                Next time, press <kbd>{modKey()}</kbd>
                <kbd>K</kbd> on any screen.
              </p>
            ) : null}
          </header>
        ) : null}
        {palette}
      </div>
      <div className="ask__card">
        {chosen ? (
          <PurchaseCard key={chosen.listing.hash} listing={chosen.listing} view={view ?? null} />
        ) : layout === "page" ? (
          <p className="ask__placeholder">Choose a match with Enter, or click it, to see exactly what your agent would countersign.</p>
        ) : null}
      </div>
    </div>
  );
}

function verdictFor(listing: Listing, view: EnvelopeView | undefined): Verdict {
  if (!view) return null;
  const amount = listing.offer.price;
  const decision = checkEnvelope(view.envelope, view.spent, { seller: listing.offer.seller, offerHash: listing.hash, amount }, nowUnix());
  return { decision, asks: view.askAbove !== null && BigInt(amount) > BigInt(view.askAbove) };
}

/** One match: the seller's glyph, the offer and one plain reason, the price, and the key that opens it. */
function Row({
  id,
  m,
  verdict,
  active,
  picked,
  onHover,
  onOpen,
  onAllow,
}: {
  id: string;
  m: Match;
  verdict: Verdict;
  active: boolean;
  picked: boolean;
  onHover: () => void;
  onOpen: () => void;
  /** The way forward when the envelope refuses only because the seller is not on the allowlist. */
  onAllow?: () => void;
}) {
  const { offer } = m.listing;
  const refusal = verdict && !verdict.decision.ok ? verdict.decision : null;
  const allowlistOnly = refusal?.reason === "not-allowlisted";
  return (
    <div
      id={id}
      data-hash={m.listing.hash}
      role="option"
      aria-selected={active}
      aria-disabled={refusal ? true : undefined}
      className={cx("prow", active && "is-active", picked && "is-picked", refusal && "prow--refused")}
      onMouseMove={refusal ? undefined : onHover}
      onClick={refusal ? undefined : onOpen}
    >
      <AddressGlyph address={offer.seller} size={20} />
      <span className="prow__main">
        <span className="prow__title">
          {offer.title} <Tag>{offer.adapter}</Tag>
        </span>
        <span className="prow__why">{refusal ? refusal.message : plainReason(m.why)}</span>
        {refusal && allowlistOnly ? (
          onAllow ? (
            <span className="prow__allow">
              <button type="button" className="prow__allow-button" onClick={onAllow}>
                Allow this seller
              </button>
              <span className="prow__allow-note">Adds it to your envelope’s allowlist and checks again. Nothing is bought.</span>
            </span>
          ) : (
            <span className="prow__allow-note">Your allowlist lives on your agent’s machine. Add this seller there, and its next signed copy shows here.</span>
          )
        ) : null}
      </span>
      <span className="prow__price">
        <Amount money={usd(offer.price, offer.rails[0])} size="sm" />
      </span>
      <span className="prow__key" aria-hidden="true">
        {active ? "↵" : ""}
      </span>
    </div>
  );
}

/** The purchase card: exactly what the agent signs, your envelope's checklist, the hold, then the call it makes. */
function PurchaseCard({ listing, view }: { listing: Listing; view: EnvelopeView | null }) {
  const [signed, setSigned] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const { offer } = listing;
  const money = usd(offer.price, offer.rails[0]);
  const hub = hubBase();
  const base = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const command = buyCommand(listing.hash, offer.input, base);
  const agent = view?.agentName ?? "Your agent";
  const checks = view
    ? envelopeChecklist(view, {
        seller: offer.seller,
        offerHash: listing.hash,
        amount: offer.price,
        sellerName: listing.seller.named === false ? "this seller" : listing.seller.name,
      })
    : null;
  // A block body on purpose: scrollIntoView returns a Promise in current Chrome, and React would take it for a cleanup.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <section ref={ref} className="pcard" aria-labelledby="pcard-title">
      <header className="pcard__head">
        <p className="label">Purchase</p>
        <h2 id="pcard-title" className="pcard__title">
          <Link to={`/offer/${listing.hash}`}>{offer.title}</Link>
        </h2>
      </header>
      <p className="pcard__exact">
        <span className="label">{agent} countersigns exactly</span>
        <Amount money={money} size="lg" flight />
      </p>
      <dl className="pcard__fields">
        <div>
          <dt className="label">Payee, locked</dt>
          <dd>
            <Hash value={offer.seller} label="payee" copy={false} />
          </dd>
        </div>
        <div>
          <dt className="label">Rail</dt>
          <dd>{RAIL_LABEL[offer.rails[0]!]}</dd>
        </div>
        <div>
          <dt className="label">Deadline</dt>
          <dd className="num">{formatDuration(offer.deadline)}, then anyone can refund</dd>
        </div>
        <div>
          <dt className="label">Offer hash</dt>
          <dd>
            <Hash value={listing.hash} label="offer hash" copy={false} />
          </dd>
        </div>
      </dl>
      <div className="pcard__checks">
        <p className="label">Your envelope</p>
        {checks ? (
          <Checklist items={checks} />
        ) : (
          <p className="pcard__unchecked">Your envelope is not on this hub, so this purchase is not checked here. Your agent checks it before it pays.</p>
        )}
      </div>
      <HoldToSign ariaLabel={`Countersign ${formatMoney(money)} for ${offer.title}`} left={listing.seller.name} right="you" onSigned={() => setSigned(true)} />
      {signed ? (
        <div className="pcard__next" role="status">
          <p className="pcard__next-title">Countersigned for {agent}.</p>
          <p className="pcard__next-body">Your agent makes the paid call with its own key. Nothing has moved yet, and nothing moves at any other price.</p>
          <div className="command">
            <div className="command__head">
              <p className="label">The call it makes</p>
              <CopyButton value={command} label="buy command" />
            </div>
            <pre className="command__body mono">{command}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
