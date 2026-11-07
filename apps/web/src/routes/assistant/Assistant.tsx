import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { checkEnvelope } from "@countersign/core";
import { useAccount, useSwitchChain } from "wagmi";
import { useWalletMode } from "../../app/Providers.tsx";
import { href, Link } from "../../app/router.tsx";
import { api, useResource, type Resource } from "../../lib/api.ts";
import { ARC_CHAIN_ID } from "../../lib/arc-pin.ts";
import { envelopeChecklist } from "../../lib/checklist.ts";
import { formatClock, formatMoney, nowUnix, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import {
  announceHederaBuy,
  buyOnHedera,
  getHederaAccount,
  HederaError,
  type HederaAccount,
  type HederaPurchase,
} from "../../lib/hedera.ts";
import { hubBase, isOwnHub } from "../../lib/hub.ts";
import { usePurchase } from "../../lib/purchase.ts";
import { deadlineWords, termsKind } from "../../lib/terms.ts";
import type { EnvelopeView, Listing, RailId } from "../../lib/types.ts";
import { AddressGlyph } from "../../ui/AddressGlyph.tsx";
import { Checklist } from "../../ui/Checklist.tsx";
import { HoldToSign } from "../../ui/HoldToSign.tsx";
import { NeedsSignature } from "../../ui/NeedsSignature.tsx";
import { PurchaseResult } from "../../ui/PurchaseResult.tsx";
import { SignReview } from "../../ui/SignReview.tsx";
import { Amount, Button, CopyButton, FixtureNote, Hash, Tag, cx } from "../../ui/primitives.tsx";
import { rank, type Match } from "../buyer/assistant.ts";
import { buyCommand, exampleInput } from "../offer/index.tsx";
import { cardMode } from "./cardMode.ts";
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
  /** Enter pressed before the answer arrived: open the top match as soon as it lands. */
  const [queued, setQueued] = useState(false);
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
    const text = query.trim();
    if (answer && answer.need === text && !busy) {
      if (current) open(current);
      return;
    }
    // Enter before the answer: search now and keep the Enter, so the top match opens when it lands.
    if (text) {
      setQueued(true);
      void ask(query);
    }
  };

  useEffect(() => {
    if (!queued || busy || !answer || answer.need !== query.trim()) return;
    setQueued(false);
    const top = rows[0];
    if (top) open(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, busy, answer, query]);

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
          onChange={(e) => {
            // Typing again withdraws an Enter that was waiting for the earlier answer.
            setQueued(false);
            setQuery(e.target.value);
          }}
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
              <li>Holding here signs nothing. Your agent countersigns with its own key when it runs the command below.</li>
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
                      <span className="example__hits">
                        {`finds ${x.hits.offer.title} · ${formatMoney(usd(x.hits.offer.price, x.hits.offer.rails[0]))}`}
                      </span>
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
          <div className="ask__placeholder" data-testid="ask-placeholder">
            <p className="ask__placeholder-title">The purchase card</p>
            <p>
              Choose a match, with Enter or a click, to see exactly what your agent would countersign: the amount, the payee,
              the rail and its deadline, each checked against your envelope.
            </p>
            <p>
              If the offer takes Arc's escrow rail and your wallet is on Arc testnet, you can review it and sign it yourself.
              Otherwise the card is a labelled preview that hands your agent the command, and opens no wallet.
            </p>
          </div>
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
  const [attempt, setAttempt] = useState(0);
  const rails = useResource(() => api.rails(), []);
  const account = useAccount();
  const { switchChain } = useSwitchChain();
  const purchase = usePurchase();
  const walletMode = useWalletMode();
  const ref = useRef<HTMLElement>(null);
  const { offer } = listing;
  const hub = hubBase();
  const base = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const command = buyCommand(listing.hash, offer.input, base);
  const agent = view?.agentName ?? "Your agent";
  const mode = cardMode({ connected: account.status === "connected", chainId: account.chainId, rails: offer.rails });
  const wallet = mode.wallet;
  const why = mode.wallet ? null : mode.why;
  // A connected wallet whose only obstacle is the chain gets the switch button.
  const chainOnly = why !== null && offer.rails.includes("escrow");
  const declared = (id: RailId) => rails.data?.find((d) => d.id === id);
  const rail: RailId = wallet ? "escrow" : offer.rails[0]!;
  // The amount in the asset of the rail this card shows: Arc USDC whenever the wallet signs.
  const money = usd(offer.price, rail);
  const declaration = declared(rail);
  const kind = declaration ? termsKind(declaration) : undefined;
  const input = exampleInput(offer.input);
  const retryable = purchase.note !== null || purchase.outcome?.kind === "refused";
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
          <dd>{RAIL_LABEL[rail]}</dd>
        </div>
        <div>
          <dt className="label">Deadline</dt>
          <dd className="num">{deadlineWords(kind, offer.deadline)}</dd>
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
      {wallet ? (
        <>
          {/* The wallet never opens from here: this asks the hub for its terms, and the review below opens it. */}
          <Button
            data-testid="pcard-ask"
            variant="primary"
            disabled={purchase.phase !== "idle" || purchase.outcome?.kind === "paid"}
            onClick={() => void purchase.buy(listing, exampleInput(offer.input))}
          >
            {purchase.phase === "asking" ? "Asking the hub for its terms" : "Review what your wallet would sign"}
          </Button>
          <p className="pcard__input">
            Input <span className="mono">{JSON.stringify(input)}</span>
          </p>
          {purchase.pending && (purchase.phase === "review" || purchase.phase === "signing") ? (
            <SignReview
              pending={purchase.pending}
              busy={purchase.phase === "signing"}
              onConfirm={() => void purchase.confirm()}
              onCancel={purchase.cancel}
              testIdPrefix="pcard"
            />
          ) : null}
          {purchase.phase === "signing" ? (
            <p className="pcard__phase" role="status">
              Signing in your wallet
            </p>
          ) : purchase.phase === "sending" ? (
            <p className="pcard__phase" role="status">
              Sending to the hub
            </p>
          ) : null}
          <PurchaseResult
            signature={purchase.signature}
            signer={purchase.signer}
            note={purchase.note}
            outcome={purchase.outcome}
            testIdPrefix="pcard"
          />
          {retryable ? (
            <Button
              data-testid="pcard-again"
              variant="secondary"
              onClick={() => {
                purchase.reset();
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {why !== null ? (
            <p className="pcard__why" data-testid="pcard-why">
              {why}
            </p>
          ) : null}
          {chainOnly ? (
            <Button data-testid="pcard-switch" variant="secondary" onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}>
              Switch to Arc testnet
            </Button>
          ) : null}
          <HoldToSign
            key={attempt}
            ariaLabel={`Get your agent's command to countersign ${formatMoney(money)} for ${offer.title}`}
            left={listing.seller.name}
            right="you"
            label="Hold to get your agent's command"
            holdingLabel="Keep holding"
            doneLabel={`Ready for ${agent}`}
            onSigned={() => setSigned(true)}
          />
          <NeedsSignature />
          {signed ? (
            <div className="pcard__next" role="status">
              <p className="pcard__next-title">Ready for {agent}. Run this on its machine to countersign:</p>
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
        </>
      )}
      {walletMode.privy && hub && isOwnHub() && offer.rails.includes("hedera") ? <HederaPay listing={listing} input={input} /> : null}
    </section>
  );
}

/** The hub signs with the account it holds; this card only holds a button and shows what the hub answers. */
export type HederaBuyState =
  | { kind: "idle" }
  | { kind: "paying" }
  | { kind: "paid"; purchase: HederaPurchase }
  | { kind: "failed"; message: string };

/** The Hedera action belongs to offers on the hedera rail, once the person has an account on this console's own hub. */
export function hederaActionShown(rails: RailId[], account: HederaAccount | null): boolean {
  return isOwnHub() && account !== null && rails.includes("hedera");
}

/** The card's Hedera section at each point in the purchase. Renderable without Privy, for tests. */
export function HederaAction({
  listing,
  account,
  state,
  onPay,
}: {
  listing: Listing;
  account: HederaAccount | null;
  state: HederaBuyState;
  onPay: () => void;
}) {
  if (!hederaActionShown(listing.offer.rails, account)) return null;
  const money = usd(listing.offer.price, "hedera");
  const busy = state.kind === "paying";
  const paid = state.kind === "paid";
  return (
    <div className="pcard__next" data-testid="hedera-action">
      <p className="label">Hedera</p>
      <HoldToSign
        key={state.kind}
        ariaLabel={`Hold to pay ${formatMoney(money)} for ${listing.offer.title} on Hedera`}
        left={listing.seller.name}
        right="you"
        label="Hold to pay on Hedera"
        holdingLabel="Keep holding"
        doneLabel="Paid on Hedera"
        disabled={busy || paid}
        signed={paid}
        onSigned={onPay}
      />
      {busy ? (
        <p className="pcard__phase" role="status" data-testid="hedera-paying">
          Paying on Hedera. The seller is working; this takes a few seconds on testnet.
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <p className="purchase__message" role="alert" data-testid="hedera-error">
          {state.message}
        </p>
      ) : null}
      {state.kind === "paid" ? (
        <>
          <HederaSteps purchase={state.purchase} />
          <HederaOutput output={state.purchase.output} />
        </>
      ) : null}
    </div>
  );
}

/** The hub's steps in its own order, each with its local time and its link when it has one. */
export function HederaSteps({ purchase }: { purchase: HederaPurchase }) {
  return (
    <ol className="pcard__next" aria-label="Payment steps" data-testid="hedera-steps">
      {purchase.steps.map((step, index) => (
        <li key={`${index}-${step.label}`} className="purchase__slip">
          <span>{step.label}</span>
          <span className="num">{stepClock(step.at)}</span>
          {step.url ? <HederaStepLink url={step.url} /> : null}
        </li>
      ))}
    </ol>
  );
}

export function HederaOutput({ output }: { output: unknown }) {
  if (output === undefined) return null;
  const text = JSON.stringify(output, null, 2);
  if (text === undefined) return null;
  return (
    <div className="command">
      <div className="command__head">
        <p className="label">Output</p>
      </div>
      <pre className="command__body mono" data-testid="hedera-output">
        {text}
      </pre>
    </div>
  );
}

function stepClock(at: string): string {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? formatClock(Math.floor(ms / 1000)) : at;
}

function HederaStepLink({ url }: { url: string }) {
  const external = /^https?:\/\//i.test(url);
  return external ? (
    <a className="purchase__faucet" href={url} target="_blank" rel="noopener noreferrer" data-testid="hedera-step-link">
      HashScan
    </a>
  ) : (
    <a className="purchase__faucet" href={href(url)} data-testid="hedera-step-link">
      Verify the slip
    </a>
  );
}

/** Signed in and with an account, the card asks the hub for its account; the hub does the rest. */
function HederaPay({ listing, input }: { listing: Listing; input: unknown }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [account, setAccount] = useState<HederaAccount | null>(null);
  const [state, setState] = useState<HederaBuyState>({ kind: "idle" });
  const tokenOf = useRef(getAccessToken);
  tokenOf.current = getAccessToken;

  useEffect(() => {
    if (!ready || !authenticated || !isOwnHub()) {
      setAccount(null);
      return;
    }
    let alive = true;
    void (async () => {
      const token = await tokenOf.current();
      if (!token) return;
      try {
        const found = await getHederaAccount(token);
        if (alive) setAccount(found);
      } catch {
        // No account line: the feature may be off, provisioning, or the hub unreachable.
        if (alive) setAccount(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, authenticated]);

  const pay = async () => {
    if (state.kind === "paying") return;
    setState({ kind: "paying" });
    try {
      const token = await tokenOf.current();
      if (!token) {
        setState({ kind: "failed", message: "Sign in again to pay on Hedera." });
        return;
      }
      const purchase = await buyOnHedera(token, listing.hash, input);
      setState({ kind: "paid", purchase });
      announceHederaBuy();
    } catch (error) {
      setState({ kind: "failed", message: error instanceof HederaError ? error.message : "The hub did not answer." });
    }
  };

  return <HederaAction listing={listing} account={account} state={state} onPay={() => void pay()} />;
}
