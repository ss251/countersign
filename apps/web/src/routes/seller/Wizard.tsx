import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { RailId } from "@countersign/core";
import { Link, navigate } from "../../app/router.tsx";
import { formatDuration, RAIL_LABEL, symbolFor, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import { Amount, Button, CopyButton, cx, RailTag } from "../../ui/primitives.tsx";
import {
  absoluteHub,
  offerPreview,
  parseDeadline,
  parseSkill,
  priceToAtomic,
  publishCommand,
  RAIL_ORDER,
  RAILS_ERROR,
  serveCommand,
  toggleRail,
  type ParsedSkill,
} from "./logic.ts";

const STEPS = ["Skill", "Terms", "Check", "Publish"] as const;

const RAIL_NOTE: Record<RailId, string> = {
  escrow: "USDC held in escrow on Arc until the output checks out.",
  gateway: "Circle Gateway nanopayments, credited to you in batches.",
  eip3009: "A direct USDC transfer on Arc, final when it lands.",
  whitechain: "USDT in escrow on Whitechain; buyers pay no gas.",
  hedera: "USDC on Hedera through an x402 facilitator.",
  erc8183: "The ERC-8183 job escrow, with the slip committed by its hook.",
};

/** SKILL.md in, a signed offer out: the page builds the terms, the seller's runner signs them. */
export function PublishWizard() {
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState<boolean[]>([false, false, false, false]);
  const [text, setText] = useState("");
  const [price, setPrice] = useState("0.05");
  const [deadline, setDeadline] = useState("120");
  const [rails, setRails] = useState<RailId[]>(["escrow"]);
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [licence, setLicence] = useState("");
  const [hub] = useState(() => absoluteHub(hubBase(), window.location.origin));
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const skill = parseSkill(text);
  const priceResult = priceToAtomic(price);
  const deadlineResult = parseDeadline(deadline);
  const upstreamPaired = Boolean(upstreamUrl.trim()) === Boolean(licence.trim());
  const errors = {
    skill: text.trim() && !skill.ok ? skill.error : !text.trim() ? "Paste a SKILL.md or open the file." : null,
    price: priceResult.ok ? null : priceResult.error,
    deadline: deadlineResult.ok ? null : deadlineResult.error,
    rails: rails.length ? null : RAILS_ERROR,
    upstream: upstreamPaired ? null : "Give both the upstream URL and its licence, or neither.",
  };
  const stepErrors = [[errors.skill], [errors.price, errors.deadline, errors.rails, errors.upstream], [], []];
  const show = (i: number) => tried[i] === true;

  const next = () => {
    setTried((t) => t.map((v, i) => (i === step ? true : v)));
    if (stepErrors[step]?.some(Boolean)) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const parsed: ParsedSkill | null = skill.ok ? skill : null;
  const atomic = priceResult.ok ? priceResult.atomic : "0";
  const seconds = deadlineResult.ok ? deadlineResult.seconds : 0;
  const upstream = upstreamUrl.trim() && licence.trim() ? { url: upstreamUrl.trim(), licence: licence.trim() } : undefined;
  const commandOptions = {
    hub,
    price: atomic,
    deadline: seconds,
    rails,
    upstreamUrl: upstream?.url,
    licence: upstream?.licence,
  };

  return (
    <div className="page wizard">
      <header className="page__head">
        <p className="page__eyebrow">
          <Link to="/seller">Seller</Link> / Publish
        </p>
        <h1 className="page__title">Publish a skill</h1>
        <p className="page__lede">
          The page builds the offer. Your runner signs it with your key, on your machine, and serves the calls.
        </p>
      </header>

      <ol className="steps" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className={cx("steps__item", i === step && "is-current", i < step && "is-done")} aria-current={i === step ? "step" : undefined}>
            {i < step ? (
              <button type="button" className="steps__button" onClick={() => setStep(i)}>
                <span className="steps__n num">{i + 1}</span> {label}
              </button>
            ) : (
              <span className="steps__button">
                <span className="steps__n num">{i + 1}</span> {label}
              </span>
            )}
          </li>
        ))}
      </ol>

      <form
        className="wizard__panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) next();
          else navigate("/seller");
        }}
      >
        <h2 className="wizard__title" ref={heading} tabIndex={-1}>
          {["Paste the skill", "Set the terms", "Check what you publish", "Publish it from your machine"][step]}
        </h2>

        {step === 0 ? (
          <SkillStep text={text} setText={setText} error={show(0) ? errors.skill : null} parsed={parsed} />
        ) : null}

        {step === 1 ? (
          <TermsStep
            price={price}
            setPrice={setPrice}
            deadline={deadline}
            setDeadline={setDeadline}
            rails={rails}
            setRails={setRails}
            upstreamUrl={upstreamUrl}
            setUpstreamUrl={setUpstreamUrl}
            licence={licence}
            setLicence={setLicence}
            errors={show(1) ? errors : { price: null, deadline: null, rails: null, upstream: null, skill: null }}
            seconds={seconds}
          />
        ) : null}

        {step === 2 && parsed ? (
          <CheckStep skill={parsed} atomic={atomic} seconds={seconds} rails={rails} upstream={upstream} />
        ) : null}

        {step === 3 ? (
          <div className="wizard__commands">
            <p className="wizard__note">
              Your key stays on your machine. The runner reads it from <span className="mono">CS_SELLER_KEY</span> and never
              prints it.
            </p>
            <Command label="Sign and publish the offer" value={publishCommand(commandOptions)} />
            <Command label="Then keep it online" value={serveCommand(commandOptions)} />
            <p className="wizard__note">
              Run both from the repository root, beside your SKILL.md. The offer is listed once the hub has its signature, and
              buyers can pay once the runner is connected.
            </p>
          </div>
        ) : null}

        <div className="wizard__nav">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <Link to="/seller" className="btn btn--quiet">
              Cancel
            </Link>
          )}
          <Button variant="primary" type="submit">
            {step < STEPS.length - 1 ? "Continue" : "Done"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SkillStep({
  text,
  setText,
  error,
  parsed,
}: {
  text: string;
  setText: (t: string) => void;
  error: string | null;
  parsed: ParsedSkill | null;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="wizard__fields">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          SKILL.md
        </label>
        <textarea
          id={id}
          className="input wizard__skill mono"
          rows={14}
          spellCheck={false}
          autoCapitalize="off"
          value={text}
          placeholder={"---\nname: use-arc\ndescription: Build on Arc …\n---\n\n# use-arc\n…"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? (
          <p id={`${id}-error`} className="field__error">
            {error}
          </p>
        ) : null}
      </div>
      <div className="button-row">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          Open a file
        </Button>
        <input
          ref={file}
          type="file"
          accept=".md,text/markdown,text/plain"
          hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then(setText);
            e.target.value = "";
          }}
        />
      </div>
      {parsed ? (
        <div className="wizard__parsed" aria-live="polite">
          <p className="wizard__parsed-label">Buyers will see</p>
          <p className="wizard__parsed-title">{parsed.name}</p>
          <p className="wizard__parsed-summary">{parsed.summary || "No description in the front matter."}</p>
        </div>
      ) : null}
    </div>
  );
}

function TermsStep(props: {
  price: string;
  setPrice: (v: string) => void;
  deadline: string;
  setDeadline: (v: string) => void;
  rails: RailId[];
  setRails: (r: RailId[]) => void;
  upstreamUrl: string;
  setUpstreamUrl: (v: string) => void;
  licence: string;
  setLicence: (v: string) => void;
  errors: Record<"price" | "deadline" | "rails" | "upstream" | "skill", string | null>;
  seconds: number;
}) {
  const { errors } = props;
  const ids = { price: useId(), deadline: useId(), url: useId(), licence: useId() };
  const symbol = symbolFor(props.rails[0]);
  return (
    <div className="wizard__fields">
      <div className="wizard__pair">
        <Field id={ids.price} label="Price per call" error={errors.price}>
          <div className="input-suffix">
            <input
              id={ids.price}
              className="input num"
              inputMode="decimal"
              enterKeyHint="next"
              autoComplete="off"
              data-1p-ignore
              value={props.price}
              aria-invalid={errors.price ? true : undefined}
              aria-describedby={errors.price ? `${ids.price}-error` : undefined}
              onChange={(e) => props.setPrice(e.target.value)}
            />
            <span className="input-suffix__unit" aria-hidden="true">
              {symbol}
            </span>
          </div>
        </Field>
        <Field id={ids.deadline} label="Delivery deadline, in seconds" error={errors.deadline}>
          <div className="input-suffix">
            <input
              id={ids.deadline}
              className="input num"
              inputMode="numeric"
              enterKeyHint="next"
              autoComplete="off"
              data-1p-ignore
              value={props.deadline}
              aria-invalid={errors.deadline ? true : undefined}
              aria-describedby={errors.deadline ? `${ids.deadline}-error` : `${ids.deadline}-hint`}
              onChange={(e) => props.setDeadline(e.target.value)}
            />
            <span className="input-suffix__unit" aria-hidden="true">
              {props.seconds ? formatDuration(props.seconds) : "s"}
            </span>
          </div>
          {errors.deadline ? null : (
            <p id={`${ids.deadline}-hint`} className="field__hint">
              After it, anyone can refund the buyer.
            </p>
          )}
        </Field>
      </div>

      <fieldset className="rails-pick" aria-describedby={errors.rails ? "rails-error" : undefined}>
        <legend className="field__label">Rails it accepts</legend>
        <p className="field__hint">The first one you tick is the one buyers are offered first.</p>
        {RAIL_ORDER.map((rail) => (
          <label key={rail} className={cx("rails-pick__row", props.rails.includes(rail) && "is-on")}>
            <input type="checkbox" checked={props.rails.includes(rail)} onChange={() => props.setRails(toggleRail(props.rails, rail))} />
            <span className="rails-pick__text">
              <span className="rails-pick__name">{RAIL_LABEL[rail]}</span>
              <span className="rails-pick__note">{RAIL_NOTE[rail]}</span>
            </span>
          </label>
        ))}
        {errors.rails ? (
          <p id="rails-error" className="field__error">
            {errors.rails}
          </p>
        ) : null}
      </fieldset>

      <div className="wizard__pair">
        <Field id={ids.url} label="Upstream URL" hint="Where the skill comes from. Optional." error={errors.upstream}>
          <input
            id={ids.url}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={props.upstreamUrl}
            placeholder="https://github.com/…"
            aria-invalid={errors.upstream ? true : undefined}
            onChange={(e) => props.setUpstreamUrl(e.target.value)}
          />
        </Field>
        <Field id={ids.licence} label="Licence" hint="As the upstream publishes it.">
          <input
            id={ids.licence}
            className="input"
            autoComplete="off"
            spellCheck={false}
            value={props.licence}
            placeholder="Apache-2.0"
            onChange={(e) => props.setLicence(e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function CheckStep({
  skill,
  atomic,
  seconds,
  rails,
  upstream,
}: {
  skill: ParsedSkill;
  atomic: string;
  seconds: number;
  rails: RailId[];
  upstream?: { url: string; licence: string };
}) {
  const preview = offerPreview({ title: skill.name, summary: skill.summary, price: atomic, deadline: seconds, rails, upstream });
  const excerpt = skill.body.split(/\r?\n/).slice(0, 12).join("\n");
  return (
    <div className="wizard__fields">
      <div className="split-check">
        <section className="split-check__half" aria-labelledby="sees">
          <h3 id="sees" className="split-check__title">
            What buyers see
          </h3>
          <p className="split-check__name">{skill.name}</p>
          <p className="split-check__summary">{skill.summary}</p>
          <Amount money={usd(atomic, rails[0])} size="lg" />
          <p className="split-check__meta num">Deadline {formatDuration(seconds)}</p>
          <p className="split-check__rails">
            {rails.map((r) => (
              <RailTag key={r} rail={r} />
            ))}
          </p>
        </section>
        <section className="split-check__half split-check__half--yours" aria-labelledby="stays">
          <h3 id="stays" className="split-check__title">
            What stays with you
          </h3>
          <pre className="split-check__body mono">{excerpt || "(no body)"}</pre>
          <p className="split-check__meta">
            Key in <span className="mono">CS_SELLER_KEY</span>, runner on your machine.
          </p>
        </section>
      </div>
      <div className="field">
        <p className="field__label">The offer your runner will sign</p>
        <pre className="code mono">{JSON.stringify(preview, null, 2)}</pre>
        <p className="field__hint">
          The runner fills in your address and the time, then signs. The offer hash covers every field, so any change, the
          price included, is a new offer.
        </p>
      </div>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="field__error">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

function Command({ label, value }: { label: string; value: string }) {
  return (
    <div className="command">
      <div className="command__head">
        <p className="field__label">{label}</p>
        <CopyButton value={value} label={label.toLowerCase()} />
      </div>
      <pre className="command__body mono">{value}</pre>
    </div>
  );
}
