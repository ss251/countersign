import { useState } from "react";
import type { JsonSchema } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDateTime, formatDuration, RAIL_LABEL, shortHex, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import { RailCard } from "../../ui/RailCard.tsx";
import { Amount, CopyButton, Empty, FixtureNote, Hash, Tag, cx } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./offer.css";

type Prop = { type?: string; description?: string };

/** One offer, as a developer reads it: who sells it and for how much, how to call it, what goes in and out. */
export default function OfferPage({ params }: PageProps) {
  const hash = params[0] ?? "";
  const listing = useResource(() => api.listing(hash), [hash]);
  const rails = useResource(() => api.rails(), []);
  const sellers = useResource(() => api.sellers(), []);
  const [via, setVia] = useState<"cli" | "curl">("cli");

  if (listing.loading && !listing.data) return <div className="page" aria-busy="true" />;
  if (listing.error) {
    return (
      <div className="page">
        <Empty title="The hub did not answer.">The offer could not be read. Try again in a moment.</Empty>
      </div>
    );
  }
  if (!listing.data) {
    return (
      <div className="page">
        <Empty title="No offer with that hash.">
          It may have been replaced: any change to an offer, the price included, gives it a new hash.{" "}
          <Link to="/registry">Browse the registry</Link>.
        </Empty>
      </div>
    );
  }

  const l = listing.data;
  const { offer } = l;
  const hub = hubBase();
  const base = hub && /^https?:/.test(hub) ? hub : `${window.location.origin}${hub ?? ""}`;
  const record = sellers.data?.find((s) => s.address.toLowerCase() === offer.seller.toLowerCase());
  const agentId = record?.erc8004?.agentId ?? l.seller.agentId;
  const cli = buyCommand(l.hash, offer.input, base);
  const curl = curlCommand(l.hash, offer.input, base);

  return (
    <div className="page offer">
      <header className="offer__head">
        <p className="page__eyebrow offer__crumbs">
          <Link to="/registry">Registry</Link> / Offer <FixtureNote show={listing.source === "fixtures"} />
        </p>
        <div className="offer__title-row">
          <h1 className="page__title">{offer.title}</h1>
          <Tag>{offer.adapter}</Tag>
        </div>
        <p className="offer__by">
          By <span className="offer__seller">{l.seller.name}</span>
          {agentId ? (
            <span className="offer__verified">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              ERC-8004 agent {agentId}
            </span>
          ) : null}
          <Hash value={offer.seller} label="seller address" />
        </p>
        <div className="offer__price-row">
          <Amount money={usd(offer.price, offer.rails[0])} size="xl" />
          <p className="offer__per num">
            per call ·{" "}
            {l.stats && l.stats.released + l.stats.refunded > 0 ? `${l.stats.released} paid · ${l.stats.refunded} refunded` : "No record yet"}
            {l.online === undefined ? "" : l.online ? " · runner online" : " · runner offline"}
          </p>
        </div>
        <p className="offer__rails">Settles on {offer.rails.map((r) => RAIL_LABEL[r]).join(", ")}</p>
        <p className="page__lede offer__summary">{offer.summary}</p>
        {offer.upstream ? (
          <p className="offer__source">
            From{" "}
            <a href={offer.upstream.url} target="_blank" rel="noreferrer">
              {offer.upstream.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>{" "}
            · {offer.upstream.licence}
          </p>
        ) : null}
      </header>

      <section className="section offer__call" aria-labelledby="call-title">
        <div className="offer__call-head">
          <h2 id="call-title" className="section__title">
            Call it
          </h2>
          <div className="switch" role="tablist" aria-label="How to call it">
            <button type="button" role="tab" aria-selected={via === "cli"} className={cx("switch__item", via === "cli" && "is-on")} onClick={() => setVia("cli")}>
              Buyer CLI
            </button>
            <button type="button" role="tab" aria-selected={via === "curl"} className={cx("switch__item", via === "curl" && "is-on")} onClick={() => setVia("curl")}>
              curl
            </button>
          </div>
        </div>
        <div className="command">
          <div className="command__head">
            <p className="field__label">
              {via === "cli" ? "Countersigns within your envelope, pays and returns the output with a slip" : "Shows the 402 with the price; paying needs a countersignature"}
            </p>
            <CopyButton value={via === "cli" ? cli : curl} label={via === "cli" ? "buy command" : "curl command"} />
          </div>
          <pre className="command__body mono">{via === "cli" ? cli : curl}</pre>
        </div>
        <p className="section__note">The agent’s key comes from CS_BUYER_KEY and never appears in a command.</p>
      </section>

      <div className="offer__cols">
        <section className="section" aria-labelledby="in-title">
          <h2 id="in-title" className="section__title">
            Input
          </h2>
          <Params schema={offer.input} />
          <p className="section__note">An input that does not match is refused before anyone pays.</p>
        </section>

        <section className="section" aria-labelledby="out-title">
          <h2 id="out-title" className="section__title">
            Output
          </h2>
          <details className="offer__details">
            <summary>Show properties</summary>
            <Params schema={offer.output} />
          </details>
          <p className="field__label">Example response</p>
          <pre className="code mono">{`200 OK\n${JSON.stringify({ output: exampleInput(offer.output), slip: { hash: "0x…", body: { offerHash: shortHex(l.hash), amount: offer.price } } }, null, 2)}`}</pre>
          <p className="section__note">An output that does not match is a failed delivery, and the money goes back.</p>
        </section>
      </div>

      <section className="section" aria-labelledby="terms-title">
        <h2 id="terms-title" className="section__title">
          Terms
        </h2>
        <dl className="terms">
          <div>
            <dt>Escrow</dt>
            <dd>The money waits on chain until the output checks out.</dd>
          </div>
          <div>
            <dt>Refund window</dt>
            <dd className="num">After {formatDuration(offer.deadline)} without delivery, anyone can refund the buyer.</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>Released only when the output matches the schema above.</dd>
          </div>
          <div>
            <dt>Bond</dt>
            <dd>
              <Amount money={usd(offer.bond, offer.rails[0])} size="sm" /> declared. No contract collects it yet.
            </dd>
          </div>
          <div>
            <dt>Offer hash</dt>
            <dd>
              <Hash value={l.hash} head={10} tail={8} label="offer hash" />
            </dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd className="num">{formatDateTime(offer.issuedAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="rails-title">
        <h2 id="rails-title" className="section__title">
          Rails, in order of preference
        </h2>
        <div className="offer__rail-list">
          {offer.rails.map((r) => {
            const d = rails.data?.find((x) => x.id === r);
            return (
              <div key={r} className="card offer__rail">
                {d ? <RailCard declaration={d} /> : <p className="section__note">{RAIL_LABEL[r]}: not declared by this hub.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="section" aria-labelledby="disc-title">
        <h2 id="disc-title" className="section__title">
          Discovery
        </h2>
        <p className="offer__disc">
          <a href={`${base}/.well-known/skills/index.json`} target="_blank" rel="noreferrer">
            Skills index
          </a>
          <a href={`${base}/openapi.json`} target="_blank" rel="noreferrer">
            OpenAPI
          </a>
          <a href={`${base}/.well-known/agent-card.json`} target="_blank" rel="noreferrer">
            Agent card
          </a>
        </p>
      </section>
    </div>
  );
}

/** A schema as a parameter list: name, type, whether it is required, and what it is. */
function Params({ schema }: { schema: JsonSchema }) {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const names = Object.keys(props);
  if (names.length === 0) return <p className="section__note">No properties declared.</p>;
  return (
    <ul className="params">
      {names.map((name) => (
        <li key={name} className="params__row">
          <span className="params__name mono">{name}</span>
          <span className="params__type">{props[name]?.type ?? "any"}</span>
          <span className={cx("params__req", required.has(name) && "is-required")}>{required.has(name) ? "required" : "optional"}</span>
          {props[name]?.description ? <span className="params__desc">{props[name]!.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A runnable example: every required field gets a placeholder of the right type. */
export function exampleInput(schema: JsonSchema): Record<string, unknown> {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const keys = required.length ? required : Object.keys(props).slice(0, 1);
  return Object.fromEntries(
    keys.map((k) => {
      const t = props[k]?.type;
      return [k, t === "number" || t === "integer" ? 1 : t === "boolean" ? true : t === "array" ? [] : t === "object" ? {} : "…"];
    }),
  );
}

export function buyCommand(offerHash: string, input: JsonSchema, hub: string): string {
  const json = JSON.stringify(exampleInput(input)).replace(/'/g, "'\\''");
  return `bun packages/buyer/src/cli.ts buy ${offerHash} --input '${json}' --hub ${hub}`;
}

export function curlCommand(offerHash: string, input: JsonSchema, hub: string): string {
  const json = JSON.stringify(exampleInput(input)).replace(/'/g, "'\\''");
  return `curl -i -X POST ${hub}/offers/${offerHash}/call -H 'content-type: application/json' -d '${json}'`;
}
