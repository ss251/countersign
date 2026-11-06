import type { JsonSchema } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatDateTime, formatDuration, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import { RailCard } from "../../ui/RailCard.tsx";
import { Amount, CopyButton, Empty, FixtureNote, Hash, KV, Tag } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./offer.css";

/** One offer in full: what it does, what it costs, how it settles, what goes in and out, how to buy it. */
export default function OfferPage({ params }: PageProps) {
  const hash = params[0] ?? "";
  const listing = useResource(() => api.listing(hash), [hash]);
  const rails = useResource(() => api.rails(), []);

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
  const command = buyCommand(l.hash, offer.input, base);

  return (
    <div className="page offer">
      <header className="page__head">
        <p className="page__eyebrow">
          <Link to="/registry">Registry</Link> / Offer <FixtureNote show={listing.source === "fixtures"} />
        </p>
        <div className="offer__title-row">
          <h1 className="page__title">{offer.title}</h1>
          <Tag>{offer.adapter}</Tag>
        </div>
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

      <div className="page__split">
        <div className="offer__main">
          <section className="section" aria-labelledby="terms-title">
            <h2 id="terms-title" className="section__title">
              Price and terms
            </h2>
            <KV
              rows={[
                ["Price", <Amount money={usd(offer.price, offer.rails[0])} size="md" />],
                ["Deadline", <span className="num">{formatDuration(offer.deadline)}, then anyone can refund</span>],
                ["Bond declared", <Amount money={usd(offer.bond, offer.rails[0])} size="sm" />],
                ["Seller", <Hash value={offer.seller} label="seller address" />],
                ["Offer hash", <Hash value={l.hash} head={10} tail={8} label="offer hash" />],
                ["Published", <span className="num">{formatDateTime(offer.issuedAt)}</span>],
              ]}
            />
          </section>

          <section className="section" aria-labelledby="rails-title">
            <h2 id="rails-title" className="section__title">
              Rails it accepts, in order of preference
            </h2>
            <div className="offer__rails">
              {offer.rails.map((r) => {
                const d = rails.data?.find((x) => x.id === r);
                return (
                  <div key={r} className="card offer__rail">
                    {d ? <RailCard declaration={d} /> : <p className="offer__muted">{r}: not declared by this hub.</p>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="section" aria-labelledby="io-title">
            <h2 id="io-title" className="section__title">
              What goes in, what comes out
            </h2>
            <div className="offer__io">
              <Schema title="Input" schema={offer.input} />
              <Schema title="Output" schema={offer.output} />
            </div>
            <p className="section__note">
              The hub refuses an input that does not match before anyone pays, and an output that does not match is a failed
              delivery: the money goes back.
            </p>
          </section>
        </div>

        <aside className="page__rail" aria-label="Buying it">
          <section className="card offer__buy">
            <h2 className="section__title">How an agent buys it</h2>
            <ol className="offer__steps">
              <li>
                It calls <span className="mono">POST /offers/…/call</span> with the input.
              </li>
              <li>The hub answers 402 with the price. The envelope checks it, then the agent countersigns the offer hash and the amount.</li>
              <li>The money waits in escrow while the seller's runner does the work, and the output comes back with a slip.</li>
            </ol>
            <div className="command">
              <div className="command__head">
                <p className="field__label">With the buyer CLI</p>
                <CopyButton value={command} label="buy command" />
              </div>
              <pre className="command__body mono">{command}</pre>
            </div>
            <p className="offer__muted">The agent's key comes from CS_BUYER_KEY and never appears in a command.</p>
          </section>
          <section className="section">
            <h2 className="section__title">Record</h2>
            <p className="num">
              {l.stats && l.stats.released + l.stats.refunded > 0
                ? `${l.stats.released} released · ${l.stats.refunded} refunded`
                : "No calls yet."}
            </p>
            {l.online !== undefined ? <p className={l.online ? "offer__online" : "offer__muted"}>{l.online ? "Runner online" : "Runner offline"}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Schema({ title, schema }: { title: string; schema: JsonSchema }) {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
  const need = required.map((k) => `${k} (${props[k]?.type ?? "any"})`).join(", ");
  return (
    <div className="schema">
      <p className="schema__title">{title}</p>
      <p className="schema__need">{need ? `Needs ${need}.` : "No required fields."}</p>
      <pre className="code mono">{JSON.stringify(schema, null, 2)}</pre>
    </div>
  );
}

/** A runnable example: every required string gets a placeholder, so the shape is right. */
export function exampleInput(schema: JsonSchema): Record<string, unknown> {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>;
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
