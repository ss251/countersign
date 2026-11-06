import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { RailId } from "@countersign/core";
import { navigate } from "../../app/router.tsx";
import { hubBase } from "../../lib/hub.ts";
import { formatDuration, RAIL_LABEL, symbolFor, usd } from "../../lib/format.ts";
import { Amount, Button, Card, CopyButton, KV, RailTag } from "../../ui/primitives.tsx";
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
  UPSTREAM_PAIR_ERROR,
  type CommandOptions,
  type ParsedSkill,
} from "./logic.ts";

const STEP_LABELS = ["Skill", "Terms", "Check", "Publish"] as const;

const STEP_LEDE = [
  "Paste the skill. The runner reads its name and description.",
  "Set the price, the deadline and the rails.",
  "Check what is published and what stays private.",
  "Run this on the machine that holds the seller key.",
] as const;

/** A SKILL.md becomes an offer, and the runner signs it on the seller's machine. */
export function PublishWizard() {
  const [step, setStep] = useState(0);
  const [skillText, setSkillText] = useState("");
  const [price, setPrice] = useState("");
  const [deadline, setDeadline] = useState("120");
  const [rails, setRails] = useState<RailId[]>(["escrow"]);
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [licence, setLicence] = useState("");
  const [hub] = useState(() => absoluteHub(hubBase(), window.location.origin));
  const fileRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const parseResult = skillText.trim() ? parseSkill(skillText) : null;
  const parsedSkill: ParsedSkill | null = parseResult?.ok ? parseResult : null;
  const skillError = parseResult && !parseResult.ok ? parseResult.error : undefined;

  const priceResult = priceToAtomic(price);
  const priceError = priceResult.ok ? undefined : priceResult.error;

  const deadlineResult = parseDeadline(deadline);
  const deadlineError = deadlineResult.ok ? undefined : deadlineResult.error;

  const railsError = rails.length === 0 ? RAILS_ERROR : undefined;

  const upstream = upstreamUrl.trim();
  const licenceText = licence.trim();
  const upstreamPairError = (upstream === "") !== (licenceText === "") ? UPSTREAM_PAIR_ERROR : undefined;

  const draft =
    parsedSkill && priceResult.ok && deadlineResult.ok
      ? {
          skill: parsedSkill,
          price: priceResult.atomic,
          deadline: deadlineResult.seconds,
        }
      : null;

  const upstreamValue = upstream && licenceText ? { url: upstream, licence: licenceText } : undefined;

  const offer = draft
    ? offerPreview({
        title: draft.skill.name,
        summary: draft.skill.summary,
        price: draft.price,
        deadline: draft.deadline,
        rails,
        upstream: upstreamValue,
      })
    : null;

  const commandOptions: CommandOptions | null = draft
    ? {
        hub,
        price: draft.price,
        deadline: draft.deadline,
        rails,
        upstreamUrl: upstreamValue?.url,
        licence: upstreamValue?.licence,
      }
    : null;

  const publish = commandOptions ? publishCommand(commandOptions) : "";
  const serve = commandOptions ? serveCommand(commandOptions) : "";
  const canNext =
    step === 0
      ? parsedSkill !== null
      : step === 1
        ? priceResult.ok && deadlineResult.ok && rails.length > 0 && upstreamPairError === undefined
        : true;

  const back = () => {
    if (step === 0) navigate("/seller");
    else setStep(step - 1);
  };

  const openFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(setSkillText);
    event.target.value = "";
  };

  return (
    <div className="page seller-wizard">
      <nav className="seller-steps" aria-label="Steps">
        <ol className="seller-steps__list">
          {STEP_LABELS.map((label, index) => (
            <li
              key={label}
              className={
                index === step ? "seller-steps__item seller-steps__item--current" : "seller-steps__item"
              }
              aria-current={index === step ? "step" : undefined}
            >
              <span className="num">{index + 1}</span> {label}
            </li>
          ))}
        </ol>
      </nav>

      <header className="page__head seller-wizard__head">
        <p className="page__eyebrow">Seller</p>
        <h1 ref={headingRef} tabIndex={-1} className="page__title seller-wizard__title">
          {STEP_LABELS[step]}
        </h1>
        <p className="page__lede">{STEP_LEDE[step]}</p>
      </header>

      {step === 0 ? (
        <div className="seller-form">
          <div className="field">
            <label className="field__label" htmlFor="skill-md">
              SKILL.md
            </label>
            <textarea
              id="skill-md"
              className="input mono seller-form__code"
              rows={14}
              value={skillText}
              placeholder={"---\nname: use-arc\ndescription: Move USDC across Arc.\n---"}
              spellCheck={false}
              aria-invalid={skillError ? true : undefined}
              aria-describedby={skillError ? "skill-error" : undefined}
              onChange={(event) => setSkillText(event.target.value)}
            />
          </div>
          <div className="button-row">
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              Open a file
            </Button>
            <label className="sr-only" htmlFor="skill-file">
              Open a SKILL.md file
            </label>
            <input
              id="skill-file"
              ref={fileRef}
              className="sr-only"
              type="file"
              accept=".md,text/markdown"
              onChange={openFile}
            />
          </div>
          {skillError ? (
            <p id="skill-error" className="seller__error" aria-live="polite">
              {skillError}
            </p>
          ) : null}
          {parsedSkill ? (
            <div className="seller-preview">
              <p className="seller-preview__label">Will be published as</p>
              <p className="seller-preview__title">{parsedSkill.name}</p>
              {parsedSkill.summary ? <p className="seller-preview__summary">{parsedSkill.summary}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="seller-form">
          <div className="seller-fields">
            <div className="field">
              <label className="field__label" htmlFor="price">
                Price
              </label>
              <div className="seller-input-suffix">
                <input
                  id="price"
                  className="input num seller-input-suffix__input"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  autoComplete="off"
                  aria-invalid={priceError ? true : undefined}
                  aria-describedby={priceError ? "price-error" : undefined}
                  onChange={(event) => setPrice(event.target.value)}
                />
                <span className="seller-input-suffix__text" aria-hidden="true">
                  {symbolFor(rails[0])}
                </span>
              </div>
              {priceError ? (
                <p id="price-error" className="seller__error" aria-live="polite">
                  {priceError}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="deadline">
                Deadline
              </label>
              <div className="seller-input-suffix">
                <input
                  id="deadline"
                  className="input num seller-input-suffix__input"
                  type="text"
                  inputMode="numeric"
                  value={deadline}
                  autoComplete="off"
                  aria-invalid={deadlineError ? true : undefined}
                  aria-describedby={deadlineError ? "deadline-error" : undefined}
                  onChange={(event) => setDeadline(event.target.value)}
                />
                <span className="seller-input-suffix__text" aria-hidden="true">
                  seconds
                </span>
              </div>
              {deadlineError ? (
                <p id="deadline-error" className="seller__error" aria-live="polite">
                  {deadlineError}
                </p>
              ) : null}
            </div>
          </div>

          <fieldset className="seller-rails" aria-describedby={railsError ? "rails-error" : undefined}>
            <legend className="field__label">Rails</legend>
            <div className="seller-rails__list">
              {RAIL_ORDER.map((rail) => (
                <label key={rail} className="seller-rail">
                  <input
                    type="checkbox"
                    checked={rails.includes(rail)}
                    onChange={() => setRails(toggleRail(rails, rail))}
                  />
                  <span>{RAIL_LABEL[rail]}</span>
                </label>
              ))}
            </div>
            {railsError ? (
              <p id="rails-error" className="seller__error" aria-live="polite">
                {railsError}
              </p>
            ) : null}
          </fieldset>

          <div className="seller-fields">
            <div className="field">
              <label className="field__label" htmlFor="upstream">
                Upstream URL (optional)
              </label>
              <input
                id="upstream"
                className="input"
                type="url"
                value={upstreamUrl}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={upstreamPairError ? true : undefined}
                aria-describedby={upstreamPairError ? "upstream-error" : undefined}
                onChange={(event) => setUpstreamUrl(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="licence">
                Licence (optional)
              </label>
              <input
                id="licence"
                className="input"
                type="text"
                value={licence}
                autoComplete="off"
                aria-invalid={upstreamPairError ? true : undefined}
                aria-describedby={upstreamPairError ? "upstream-error" : undefined}
                onChange={(event) => setLicence(event.target.value)}
              />
            </div>
          </div>
          {upstreamPairError ? (
            <p id="upstream-error" className="seller__error" aria-live="polite">
              {upstreamPairError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 && draft ? (
        <div className="seller-check-stack">
          <Card as="div" className="seller-check">
            <section className="seller-check__half" aria-labelledby="buyers-see">
              <h2 id="buyers-see" className="seller-check__title">
                What buyers see
              </h2>
              <p className="seller-check__who">The published offer</p>
              <p className="seller-check__name">{draft.skill.name}</p>
              {draft.skill.summary ? <p className="seller-check__summary">{draft.skill.summary}</p> : null}
              <KV
                rows={[
                  ["Price", <Amount money={usd(draft.price, rails[0])} size="sm" />],
                  ["Deadline", <span className="num">{formatDuration(draft.deadline)}</span>],
                  [
                    "Rails",
                    <span className="seller-rail-list">
                      {rails.map((rail) => (
                        <RailTag key={rail} rail={rail} />
                      ))}
                    </span>,
                  ],
                ]}
              />
            </section>

            <section className="seller-check__half seller-check__half--private" aria-labelledby="stays-with-you">
              <h2 id="stays-with-you" className="seller-check__title">
                What stays with you
              </h2>
              <p className="seller-check__who">The skill text and the key</p>
              <pre className="seller-check__body mono">
                {bodyPreview(draft.skill) || "No body after the front matter."}
              </pre>
              <KV
                rows={[
                  ["Key", <span className="mono">CS_SELLER_KEY</span>],
                  ["Runner", <span className="mono">packages/runner/src/cli.ts</span>],
                ]}
              />
            </section>
          </Card>

          <section className="section" aria-labelledby="offer-json-title">
            <h2 id="offer-json-title" className="section__title">
              Offer
            </h2>
            <pre className="seller-json mono">{JSON.stringify(offer, null, 2)}</pre>
            <p className="seller-note">
              The runner fills in your address and the time, then signs. The offer hash covers every field, so any
              change, the price included, is a new offer.
            </p>
          </section>
        </div>
      ) : null}

      {step === 3 && commandOptions ? (
        <div className="seller-form">
          <p className="seller-note">
            Your key stays on your machine. The runner reads it from CS_SELLER_KEY and never prints it.
          </p>

          <section className="seller-command" aria-labelledby="publish-command-title">
            <div className="seller-command__head">
              <h2 id="publish-command-title" className="seller-command__title">
                Publish the offer
              </h2>
              <CopyButton value={publish} label="publish command" />
            </div>
            <pre className="seller-command__code mono">{publish}</pre>
          </section>

          <section className="seller-command" aria-labelledby="serve-command-title">
            <div className="seller-command__head">
              <h2 id="serve-command-title" className="seller-command__title">
                Then keep it online
              </h2>
              <CopyButton value={serve} label="serve command" />
            </div>
            <pre className="seller-command__code mono">{serve}</pre>
          </section>
        </div>
      ) : null}

      <footer className="seller-wizard__foot">
        <Button variant="secondary" onClick={back}>
          Back
        </Button>
        {step < 3 ? (
          <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
            Next
          </Button>
        ) : (
          <Button variant="primary" onClick={() => navigate("/seller")}>
            Done
          </Button>
        )}
      </footer>
    </div>
  );
}

function bodyPreview(skill: ParsedSkill): string {
  return skill.body.split(/\r?\n/).slice(0, 12).join("\n");
}
