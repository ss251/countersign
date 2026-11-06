import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { PageProps } from "../../app/routes.ts";
import { Link, navigate } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatAgo, formatAmount, formatClock, networkName, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import type { HubStats, Listing, RailDeclaration, Settlement } from "../../lib/types.ts";
import { Wordmark } from "../../ui/Mark.tsx";
import { Amount, cx } from "../../ui/primitives.tsx";
import { exampleNeeds } from "../assistant/palette.ts";
import { ClearSteps } from "./Steps.tsx";
import "./home.css";
import "./landing.css";

/** The landing draws its own chrome: a wordmark and a few links on the dark field, nothing else. */
export const surface = "bare";

const REPO = "https://github.com/ss251/countersign";
const POLL_MS = 10_000;

/**
 * The front door. One statement, then the evidence for it: a live desk read from the hub every ten
 * seconds, an ask box into the assistant, the three steps beside their artifacts, and the proof.
 * Every number on this page comes from the hub; none is a stand-in.
 */
export default function Landing(_props: PageProps) {
  const stats = useResource(() => api.stats(), []);
  const settlements = useResource(() => api.settlements(8), []);
  const rails = useResource(() => api.rails(), []);
  const listings = useResource(() => api.listings(), []);
  const envelope = useResource(() => api.envelope(), []);
  usePoll(stats.reload, POLL_MS);
  usePoll(settlements.reload, POLL_MS);
  useDarkStatusBar();

  // A poll that fails keeps the last good read on screen; its "updated" time says how old it is.
  const goodStats = useRef<HubStats | null>(null);
  if (stats.source === "hub" && stats.data) goodStats.current = stats.data;
  const goodRows = useRef<Settlement[] | null>(null);
  if (settlements.data) goodRows.current = settlements.data;

  const listed = (listings.data ?? []).filter((l) => l.status === "listed");
  const featured = listed.find((l) => l.online) ?? listed[0];
  const rows = goodRows.current ?? [];
  const newest = rows.find((s) => s.kind !== "refunded");

  return (
    <div className="landing">
      <header className="landing__bar">
        <Link to="/" className="landing__brand" aria-label="countersign, home">
          <Wordmark size={22} />
        </Link>
        <nav className="landing__links" aria-label="Views">
          <Link to="/buyer">Buyer</Link>
          <Link to="/registry">Registry</Link>
          <Link to="/verify">Verify</Link>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <section className="landing__first" aria-labelledby="statement">
        <HeroLoop />
        <div className="landing__first-inner">
          <h1 id="statement" className="landing__statement">
            payments that only move when the work lands.
          </h1>
          <div className="landing__under">
            <p className="landing__what">
              countersign lets an agent pay for a tool only inside limits you sign. On an escrow rail the payment waits until the
              output checks out; every payment leaves a slip anyone can verify, without us.
            </p>
            <div className="landing__cta">
              <Link to="/assistant" className="landing__go">
                Ask for a paid tool
              </Link>
              <button
                type="button"
                className="landing__cue"
                onClick={() => {
                  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  document.getElementById("desk")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
                }}
              >
                ↓ live desk
              </button>
            </div>
          </div>
        </div>
      </section>

      <LiveDesk
        stats={goodStats.current}
        missing={goodStats.current ? undefined : stats.source === "absent" ? stats.reason : undefined}
        settlements={rows}
        settlementsLoaded={goodRows.current !== null}
        rails={rails.data}
      />

      <AskBox listings={listings.data ?? []} />

      <section className="landing__section" aria-labelledby="steps-title">
        <h2 id="steps-title" className="landing__h2">
          How a purchase clears.
        </h2>
        <ClearSteps envelope={envelope} featured={featured} newest={newest} settled={settlements.source === "hub"} />
      </section>

      <Proof rails={rails.data} />
    </div>
  );
}

/* The live desk: the hub's own totals, the rails it runs, and the last settlements as they land. */

function LiveDesk({
  stats: s,
  missing,
  settlements,
  settlementsLoaded,
  rails,
}: {
  /** The last good read of the hub's totals. */
  stats: HubStats | null;
  /** Why there are no totals at all, when the hub has never answered with them. */
  missing: string | undefined;
  settlements: Settlement[];
  settlementsLoaded: boolean;
  rails: RailDeclaration[] | undefined;
}) {
  return (
    <section id="desk" className="landing__section landing__desk" aria-labelledby="desk-title">
      <div className="landing__desk-head">
        <h2 id="desk-title" className="landing__h2">
          Live desk.
        </h2>
        {s ? (
          <p className="landing__updated">
            <span className="live-dot" aria-hidden="true" />
            live · updated <span className="mono">{formatClock(s.asOf)}</span>
          </p>
        ) : null}
      </div>

      {missing ? (
        <p className="landing__absent">{missing}</p>
      ) : (
        <div className="landing__desk-grid">
          <div className="landing__desk-left">
            <dl className="totals3" aria-busy={!s}>
              <div>
                <dt className="label">Offers listed</dt>
                <dd>{s ? <Tick value={String(s.offers.listed)} /> : <span className="totals3__wait" />}</dd>
              </div>
              <div>
                <dt className="label">Jobs settled</dt>
                <dd>{s ? <Tick value={String(s.delivered)} /> : <span className="totals3__wait" />}</dd>
              </div>
              <div>
                <dt className="label">USDC settled</dt>
                <dd>{s ? <Tick value={formatAmount(usd(s.volume))} /> : <span className="totals3__wait" />}</dd>
              </div>
            </dl>
            <ul className="rails-live" aria-label="Rails live on this hub">
              {(rails ?? []).map((r) => (
                <li key={r.id} className="rails-live__row">
                  <span className="live-dot" aria-hidden="true" />
                  <span className="rails-live__name">{RAIL_LABEL[r.id]}</span>
                  <span className="rails-live__chain">{networkName(r.network)}</span>
                  <span className="rails-live__n mono">{s ? `${s.byRail[r.id]?.delivered ?? 0} settled` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <Stream rows={settlements} loaded={settlementsLoaded} />
        </div>
      )}
    </section>
  );
}

/** The last settlements, newest first. A row that arrives after the first read slides in once. */
function Stream({ rows, loaded }: { rows: Settlement[]; loaded: boolean }) {
  const now = useNow(10_000);
  const seen = useRef<Set<string> | null>(null);
  const keyOf = (s: Settlement) => `${s.jobId}-${s.kind}`;
  const fresh = new Set(seen.current ? rows.map(keyOf).filter((k) => !seen.current!.has(k)) : []);
  useEffect(() => {
    if (!loaded) return;
    seen.current ??= new Set();
    for (const s of rows) seen.current.add(keyOf(s));
  });
  return (
    <div className="stream">
      <p className="label">Latest settlements</p>
      {loaded && rows.length === 0 ? (
        <p className="stream__none">No money has moved on this hub yet. The first release lands here.</p>
      ) : (
        <ol className="stream__list" aria-live="polite">
          {rows.slice(0, 6).map((s) => (
            <li key={keyOf(s)} className={cx("stream__row", fresh.has(keyOf(s)) && "is-new")}>
              <span className="stream__what">
                <span className="stream__title">{s.title || "Untitled offer"}</span>
                <span className="stream__meta">
                  <span className="mono">{shortHex(s.seller)}</span> · {RAIL_LABEL[s.rail]} ·{" "}
                  <span className="mono">{formatAgo(s.at, now)}</span>
                </span>
              </span>
              <span className="stream__end">
                <Amount money={usd(s.amount, s.rail)} size="sm" className={s.kind === "refunded" ? "amount--void" : undefined} />
                {s.explorer ? (
                  <a className="stream__tx" href={s.explorer} target="_blank" rel="noreferrer" aria-label={`${s.title}: open the transaction`}>
                    tx ↗
                  </a>
                ) : (
                  <span className="stream__tx stream__tx--none">{s.kind === "refunded" ? "refunded" : "no tx"}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A total that ticks once when it changes, and never counts up from zero on load. */
function Tick({ value }: { value: string }) {
  const [turn, setTurn] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setTurn((n) => n + 1);
  }, [value]);
  return (
    <span key={turn} className={cx("tick", turn > 0 && "is-ticked")}>
      {value}
    </span>
  );
}

/* The ask box: a need in plain words, straight into the assistant's palette. */

function AskBox({ listings }: { listings: Listing[] }) {
  const [need, setNeed] = useState("");
  const id = useId();
  const examples = exampleNeeds(listings);
  const go = (q: string) => navigate(`/assistant?q=${encodeURIComponent(q.trim())}`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (need.trim()) go(need);
  };
  return (
    <section className="landing__section landing__ask" aria-labelledby="ask-title">
      <h2 id="ask-title" className="landing__h2">
        Ask for a paid tool.
      </h2>
      <form className="askbox" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor={id}>
          What does your agent need?
        </label>
        <input
          id={id}
          className="askbox__input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="What does your agent need?"
          value={need}
          onChange={(e) => setNeed(e.target.value)}
        />
        <button type="submit" className="askbox__go">
          Ask
        </button>
      </form>
      {examples.length ? (
        <ul className="askbox__examples" aria-label="Needs that find a live offer">
          {examples.map((x) => (
            <li key={x.need}>
              <button type="button" className="askbox__example" onClick={() => go(x.need)}>
                <span className="mono">{x.need}</span>
                <span className="askbox__hits">finds {x.hits.offer.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* Proof: where every claim on this page can be checked without us. */

function Proof({ rails }: { rails: RailDeclaration[] | undefined }) {
  const escrow = rails?.find((r) => r.id === "escrow");
  const escrowHref =
    escrow?.escrow && escrow.explorerTx ? escrow.explorerTx.replace(/\/tx\/\{tx\}$/, `/address/${escrow.escrow}`) : undefined;
  return (
    <section className="landing__section landing__proof" aria-labelledby="proof-title">
      <h2 id="proof-title" className="landing__h2">
        Check it without us.
      </h2>
      <ul className="proof">
        <li>
          <a href={`${REPO}/blob/main/docs/proof.md`} target="_blank" rel="noreferrer">
            docs/proof.md
          </a>
          <span>Every claim, with its explorer link.</span>
        </li>
        {escrowHref && escrow?.escrow ? (
          <li>
            <a href={escrowHref} target="_blank" rel="noreferrer">
              The escrow on Arc
            </a>
            <span className="mono">{shortHex(escrow.escrow, 6, 4)}</span>
          </li>
        ) : null}
        <li>
          <a href="https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078" target="_blank" rel="noreferrer">
            A Hedera payment on HashScan
          </a>
          <span>Settled on Hedera testnet, with its slip.</span>
        </li>
        <li>
          <Link to="/verify">Verify a slip</Link>
          <span>From its own bytes and a public RPC.</span>
        </li>
        <li>
          <a href={REPO} target="_blank" rel="noreferrer">
            The repository
          </a>
          <span>The code, the spec and the end-to-end runs.</span>
        </li>
      </ul>
      <p className="landing__fine">Testnets only. Every figure on this page is read from the hub while you look at it.</p>
    </section>
  );
}

/*
 * The captain's loop, when it exists: a poster first, and the video only after first paint, only
 * if the file is there, and never under reduced motion. Until then the field stays plain.
 */
function HeroLoop() {
  const [video, setVideo] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const id = window.setTimeout(() => {
      fetch("/media/hero.mp4", { method: "HEAD" }).then(
        (r) => {
          if (alive && r.ok && (r.headers.get("content-type") ?? "").startsWith("video/")) setVideo(true);
        },
        () => undefined,
      );
    }, 800);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, []);
  return (
    <div className="landing__loop" aria-hidden="true">
      {video ? <video src="/media/hero.mp4" poster="/media/hero-poster.jpg" autoPlay muted loop playsInline preload="none" /> : null}
    </div>
  );
}

/** Read again every interval while the tab is visible; a hidden tab costs the hub nothing. */
function usePoll(reload: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, ms);
    return () => window.clearInterval(id);
  }, [reload, ms]);
}

/** The landing is dark unless light is pinned, so the phone's status bar follows it while it is open. */
function useDarkStatusBar() {
  useEffect(() => {
    if (document.documentElement.dataset.theme === "light") return;
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const before = metas.map((m) => ({ m, content: m.content, media: m.media }));
    // After the shell's own theme effect has run, so this is the last word while the landing is open.
    const frame = requestAnimationFrame(() => {
      for (const m of metas) {
        m.media = "all";
        m.content = "#121210";
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      for (const b of before) {
        b.m.content = b.content;
        b.m.media = b.media;
      }
    };
  }, []);
}
