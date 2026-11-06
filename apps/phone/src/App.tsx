import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatUnits } from "@countersign/core";
import type { Hex } from "viem";
import type { JobRecord, Phone, PhoneState, PhotoAsk, SkillState } from "./app/phone.ts";
import { SKILLS, type SkillId } from "./runner/skills.ts";

const DOCS = "https://github.com/ss251/countersign/blob/main/docs/phone.md";

const COPY: Record<SkillId, { name: string; line: string; control: string }> = {
  "phone-location": {
    name: "Location",
    line: "Where this phone is when a buyer pays. Read once for each paid job, never tracked in between.",
    control: "Share location with paying buyers",
  },
  "phone-photo": {
    name: "Photo",
    line: "A buyer asks for a picture. You read the request, then take it or decline. Every photo needs your tap.",
    control: "Take photo requests",
  },
};

export function App({ phone }: { phone: Phone }): ReactNode {
  const state = useSyncExternalStore(phone.subscribe, phone.getSnapshot);
  const ask = state.asks[0] ?? null;
  const [last, ...older] = state.jobs;

  useEffect(() => {
    document.title = ask ? "Photo request · countersign" : "countersign phone";
  }, [ask]);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <picture>
            <source srcSet="mark-dark.svg" media="(prefers-color-scheme: dark)" />
            <img src="mark.svg" width="20" height="20" alt="" />
          </picture>
          <span className="wordmark">countersign</span>
          <span className="surface">phone</span>
        </div>
        <StateLine state={state} />
      </header>

      <main className="page">
        {state.phase === "broken" && state.problem ? <p className="refusal block">{state.problem}</p> : null}

        <section className="group" aria-labelledby="sells">
          <h2 id="sells" className="label">
            This phone sells
          </h2>
          {(Object.keys(SKILLS) as SkillId[]).map((id) => (
            <SkillRow
              key={id}
              skill={state.skills[id]}
              disabled={state.phase !== "ready"}
              offerUrl={consoleLink(state, "offer", state.skills[id].hash)}
              onToggle={() => void phone.toggle(id)}
            />
          ))}
        </section>

        <section className="group" aria-labelledby="last">
          <h2 id="last" className="label">
            Last job
          </h2>
          {last ? (
            <LastJob job={last} state={state} />
          ) : (
            <p className="quiet empty">
              No job yet. When a buyer pays for one of the offers above, it arrives here with its slip.
            </p>
          )}
          {older.length > 0 ? (
            <ol className="older">
              {older.map((job) => (
                <li key={job.jobId}>
                  <span className="when">{clock(job.at)}</span>
                  <span className="what">{SKILLS[job.skill].title}</span>
                  <Money atomic={job.amount} />
                  <Verdict job={job} small />
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section className="group" aria-labelledby="key">
          <h2 id="key" className="label">
            Seller key
          </h2>
          <KeyFacts state={state} />
        </section>

        <footer className="foot">
          <a href={DOCS}>What this proves, and what it does not</a>
          <a href={state.consoleUrl}>Open the console</a>
        </footer>
      </main>

      {ask ? <PhotoSheet ask={ask} more={state.asks.length - 1} phone={phone} /> : null}
    </div>
  );
}

function StateLine({ state }: { state: PhoneState }): ReactNode {
  const now = useNow(state.link.phase === "waiting" ? 1_000 : null);
  const link = state.link;
  let tone: "live" | "work" | "idle" | "refused" = "idle";
  let words: string;
  if (state.phase === "loading") {
    words = "Opening this phone's key";
  } else if (state.phase === "broken") {
    words = "Not serving";
  } else if (link.phase === "off") {
    words = "Not serving. Turn on a skill to go online.";
  } else if (link.phase === "dialing") {
    tone = "work";
    words = "Dialing out to the hub";
  } else if (link.phase === "proving") {
    tone = "work";
    words = "Connected. Proving the seller key";
  } else if (link.phase === "registered") {
    const n = link.accepted.length;
    tone = n > 0 ? "live" : "refused";
    words = n > 0 ? `Serving ${n} ${n === 1 ? "offer" : "offers"}` : "Registered, but the hub lists none of these offers";
  } else {
    const left = Math.max(0, Math.ceil(((link.retryAt ?? now) - now) / 1000));
    tone = link.refusal ? "refused" : "idle";
    words = link.refusal ? `${link.refusal} Trying again in ${left} s.` : `Offline. Dialing again in ${left} s`;
  }
  return (
    <p className="state" role="status" data-tone={tone}>
      <span className="dot" aria-hidden="true" />
      <span className="words">{words}</span>
    </p>
  );
}

function SkillRow({
  skill,
  disabled,
  offerUrl,
  onToggle,
}: {
  skill: SkillState;
  disabled: boolean;
  offerUrl: string | null;
  onToggle: () => void;
}): ReactNode {
  const copy = COPY[skill.id];
  const busy = skill.step !== null;
  const doing = skill.step === "asking" ? "Asking the browser" : skill.step === "publishing" ? "Publishing the offer" : null;
  return (
    <article className="row skill" aria-busy={busy}>
      <div className="head">
        <h3>{copy.name}</h3>
        <Money atomic={SKILLS[skill.id].price} />
      </div>
      <p className="line">{copy.line}</p>
      <div className="control">
        <button
          type="button"
          role="switch"
          aria-checked={skill.on}
          className="switch"
          disabled={disabled || busy}
          onClick={onToggle}
        >
          <span className="track" aria-hidden="true">
            <span className="thumb" />
          </span>
          <span className="switch-label">{copy.control}</span>
        </button>
      </div>
      {doing ? <p className="note">{doing}</p> : null}
      {!doing && skill.note ? <p className="note">{skill.note}</p> : null}
      {skill.refusal ? <p className="refusal">{skill.refusal}</p> : null}
      {skill.on && skill.hash ? (
        <p className="fact">
          <span className="k">Offer</span>
          {offerUrl ? (
            <a className="mono" href={offerUrl}>
              {short(skill.hash)}
            </a>
          ) : (
            <span className="mono">{short(skill.hash)}</span>
          )}
          <span className="v">{SKILLS[skill.id].deadline} s to deliver</span>
        </p>
      ) : null}
    </article>
  );
}

function LastJob({ job, state }: { job: JobRecord; state: PhoneState }): ReactNode {
  const slipUrl = consoleLink(state, "slip", job.slipHash ?? null);
  return (
    <article className="row job">
      <div className="head">
        <h3>{SKILLS[job.skill].title}</h3>
        <Money atomic={job.amount} />
      </div>
      <Verdict job={job} />
      {job.ask ? <p className="quote">“{job.ask}”</p> : null}

      {job.location ? (
        <p className="output">
          <span className="mono">
            {job.location.lat}, {job.location.lon}
          </span>
          <span className="v">
            within {job.location.accuracyM} m at {clock(job.location.at)}
          </span>
        </p>
      ) : null}
      {job.photo ? (
        <div className="output photo">
          {job.photo.thumb ? <img src={job.photo.thumb} alt="The photo this phone sent" /> : null}
          <div>
            <p className="v">
              {job.photo.width} × {job.photo.height}, {Math.round(job.photo.bytes / 1000)} kB JPEG
            </p>
            <p className="mono hash" title={job.photo.sha256}>
              sha256 {job.photo.sha256.slice(0, 12)}…{job.photo.sha256.slice(-8)}
            </p>
          </div>
        </div>
      ) : null}
      {job.reason && job.outcome === "refused" ? <p className="refusal">{job.reason}</p> : null}

      <dl className="facts">
        {job.slipHash ? (
          <div>
            <dt>Slip</dt>
            <dd>
              {slipUrl ? (
                <a className="mono" href={slipUrl}>
                  {short(job.slipHash)}
                </a>
              ) : (
                <span className="mono">{short(job.slipHash)}</span>
              )}
            </dd>
          </div>
        ) : null}
        {job.hub?.closeTx ? (
          <div>
            <dt>{job.hub.status === "refunded" ? "Refund" : "Release"}</dt>
            <dd>
              {job.hub.url ? (
                <a className="mono money" href={job.hub.url}>
                  {short(job.hub.closeTx)}
                </a>
              ) : (
                <span className="mono">{short(job.hub.closeTx)}</span>
              )}
            </dd>
          </div>
        ) : null}
        {job.outputHash ? (
          <div>
            <dt>Output</dt>
            <dd className="mono">{short(job.outputHash)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Job</dt>
          <dd className="mono">{short(job.jobId)}</dd>
        </div>
      </dl>
    </article>
  );
}

function Verdict({ job, small = false }: { job: JobRecord; small?: boolean }): ReactNode {
  let tone: "settled" | "refused" | "plain" = "plain";
  let words: string;
  if (job.outcome === "working") words = job.skill === "phone-photo" ? "Waiting for your photo" : "Reading the position";
  else if (job.outcome === "refused") {
    tone = "refused";
    words = "Refused";
  } else if (!job.hub) words = small ? "Delivered" : "Delivered. Waiting for the hub to release.";
  else if (job.hub.status === "released" || job.hub.status === "settled") {
    tone = "settled";
    words = small ? "Released" : "Released. Slip minted.";
  } else if (job.hub.status === "refunded") words = "Refunded";
  else {
    tone = "refused";
    words = small ? "Refused" : "Refused by the hub's delivery check.";
  }
  return (
    <span className={small ? "verdict small" : "verdict"} data-tone={tone}>
      <span className="dot" aria-hidden="true" />
      {words}
    </span>
  );
}

function KeyFacts({ state }: { state: PhoneState }): ReactNode {
  const [copied, setCopied] = useState(false);
  const hubHost = safeHost(state.hubUrl);
  const copy = async (): Promise<void> => {
    if (!state.seller) return;
    try {
      await navigator.clipboard.writeText(state.seller);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="row key">
      <dl className="facts">
        <div>
          <dt>Address</dt>
          <dd className="address">
            <span className="mono">{state.seller ?? "Not made yet"}</span>
            {state.seller ? (
              <button type="button" className="text-button" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Made</dt>
          <dd>{state.madeAt ? `On this phone, ${day(state.madeAt)}` : "On first open"}</dd>
        </div>
        <div>
          <dt>Hub</dt>
          <dd className="mono">{hubHost}</dd>
        </div>
        <div>
          <dt>Screen</dt>
          <dd>
            {state.awake === "on"
              ? "Kept on while serving"
              : state.awake === "unsupported"
                ? "Keep this page open and the screen on"
                : "Sleeps normally until a skill is on"}
          </dd>
        </div>
      </dl>
      <p className="quiet">
        The key was made in this browser and never leaves it. It signs three things: the hub's sign-in nonce, the two
        offers and each slip. Testnet only: never send it real money.
      </p>
    </div>
  );
}

function PhotoSheet({ ask, more, phone }: { ask: PhotoAsk; more: number; phone: Phone }): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const now = useNow(250);
  const left = Math.max(0, ask.waitUntil - Math.floor(now / 1000));
  const preparing = ask.stage === "preparing";

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, [ask.jobId]);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby="ask-title"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="sheet-body">
        <div className="head">
          <h2 id="ask-title">Photo request</h2>
          <span className="held">
            <Money atomic={ask.amount} />
            <span className="held-word">held</span>
          </span>
        </div>
        {ask.prompt ? (
          <p className="quote big">“{ask.prompt}”</p>
        ) : (
          <p className="quiet">The buyer gave no prompt. Any photo you choose to take answers it.</p>
        )}
        <p className="wait">
          Paid into escrow. The hub waits <span className="num">{minutes(left)}</span> more, then the buyer is refunded.
        </p>
        {ask.problem ? <p className="refusal">{ask.problem}</p> : null}
        <label className={preparing ? "primary is-busy" : "primary"} aria-disabled={preparing}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            disabled={preparing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void phone.takePhoto(ask.jobId, file);
            }}
          />
          {preparing ? "Preparing the photo" : "Take photo"}
        </label>
        <button type="button" className="secondary" disabled={preparing} onClick={() => phone.decline(ask.jobId)}>
          Decline
        </button>
        <p className="quiet small">
          Shrunk on this phone to 800 px and sent with its sha256. Camera metadata, including any location, is removed.
          {more > 0 ? ` ${more} more ${more === 1 ? "request" : "requests"} waiting.` : ""}
        </p>
      </div>
    </dialog>
  );
}

function Money({ atomic }: { atomic: string }): ReactNode {
  return (
    <span className="money-figure">
      {usd(atomic)} <span className="unit">USDC</span>
    </span>
  );
}

function useNow(every: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (every === null) return;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

function consoleLink(state: PhoneState, route: "slip" | "offer", hash: Hex | null): string | null {
  if (!hash) return null;
  try {
    const url = new URL(state.consoleUrl, location.href);
    url.hash = `#/${route}/${hash}?hub=${encodeURIComponent(new URL(state.hubUrl, location.href).toString().replace(/\/+$/, ""))}`;
    return url.toString();
  } catch {
    return null;
  }
}

function usd(atomic: string): string {
  try {
    const text = formatUnits(BigInt(atomic), 6);
    const [whole, fraction = ""] = text.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  } catch {
    return atomic;
  }
}

function short(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function day(unix: number): string {
  return new Date(unix * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function minutes(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url, location.href).host;
  } catch {
    return url;
  }
}
