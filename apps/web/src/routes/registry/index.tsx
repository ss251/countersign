import { useId, useMemo, useState } from "react";
import type { AdapterKind, RailId } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { RAIL_LABEL, usd } from "../../lib/format.ts";
import type { Listing, SellerRecord } from "../../lib/types.ts";
import { Amount, Button, Empty, FixtureNote, Hash, RailTag, Tag, cx } from "../../ui/primitives.tsx";
import "../../ui/page.css";
import "./registry.css";

type AdapterFilter = "all" | AdapterKind;

const ADAPTERS: Array<{ id: AdapterFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "openapi", label: "OpenAPI" },
];

export interface SellerGroup {
  address: string;
  name: string;
  agentId?: string;
  offers: Listing[];
  /** Released on an escrow rail or settled on a direct one: the seller was paid. */
  released: number;
  refunded: number;
  /** Calls that failed before any money moved. */
  failed: number;
  online: number;
}

/** Take the hub's own counts and identity where it reports them; they come from slips and jobs. */
export function withRecords(groups: SellerGroup[], records: SellerRecord[] | null | undefined): SellerGroup[] {
  if (!records) return groups;
  const byAddress = new Map(records.map((r) => [r.address.toLowerCase(), r]));
  return groups
    .map((g) => {
      const r = byAddress.get(g.address);
      if (!r) return g;
      return {
        ...g,
        name: r.name ?? g.name,
        agentId: r.erc8004?.agentId ?? g.agentId,
        released: r.released + r.settled,
        refunded: r.refunded,
        failed: r.failed,
      };
    })
    .sort((a, b) => b.released - a.released || a.name.localeCompare(b.name));
}

/** Group listings by seller, live offers first, sellers with more delivered calls first. */
export function groupBySeller(listings: Listing[]): SellerGroup[] {
  const groups = new Map<string, SellerGroup>();
  for (const l of listings) {
    const address = l.offer.seller.toLowerCase();
    const g =
      groups.get(address) ??
      ({ address, name: l.seller.name, agentId: l.seller.agentId, offers: [], released: 0, refunded: 0, failed: 0, online: 0 } satisfies SellerGroup);
    g.offers.push(l);
    g.released += l.stats?.released ?? 0;
    g.refunded += l.stats?.refunded ?? 0;
    if (l.online) g.online += 1;
    groups.set(address, g);
  }
  for (const g of groups.values()) {
    g.offers.sort((a, b) => Number(a.status === "delisted") - Number(b.status === "delisted") || a.offer.title.localeCompare(b.offer.title));
  }
  return [...groups.values()].sort((a, b) => b.released - a.released || a.name.localeCompare(b.name));
}

/** Case-insensitive match on title, summary, seller name and address, plus adapter and rail. */
export function matches(l: Listing, text: string, adapter: AdapterFilter, rail: RailId | "all"): boolean {
  if (adapter !== "all" && l.offer.adapter !== adapter) return false;
  if (rail !== "all" && !l.offer.rails.includes(rail)) return false;
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return [l.offer.title, l.offer.summary, l.seller.name, l.offer.seller].some((f) => f.toLowerCase().includes(q));
}

/** Delivered share: released over released plus refunded. A dash, never 0%, before any call. */
export function deliveryRate(released: number, refunded: number): string {
  const n = released + refunded;
  return n === 0 ? "—" : `${Math.round((released / n) * 100)}%`;
}

/** Every seller this hub knows and what each sells, with who they are and how they have delivered. */
export default function RegistryPage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const sellers = useResource(() => api.sellers(), []);
  const [text, setText] = useState("");
  const [adapter, setAdapter] = useState<AdapterFilter>("all");
  const [rail, setRail] = useState<RailId | "all">("all");
  const searchId = useId();
  const railId = useId();

  const all = listings.data ?? [];
  const rails = useMemo(() => [...new Set(all.flatMap((l) => l.offer.rails))], [all]);
  const visible = all.filter((l) => matches(l, text, adapter, rail));
  const groups = withRecords(groupBySeller(visible), sellers.data);
  const filtered = Boolean(text.trim()) || adapter !== "all" || rail !== "all";
  const online = visible.filter((l) => l.online).length;
  const clear = () => {
    setText("");
    setAdapter("all");
    setRail("all");
  };

  return (
    <div className="page registry">
      <header className="page__head">
        <p className="page__eyebrow">
          Registry <FixtureNote show={listings.source === "fixtures"} />
        </p>
        <h1 className="page__title">Every seller on this hub, and what they sell.</h1>
        <p className="page__lede">
          An offer is a price and two schemas; the code behind it stays on the seller’s machine. Each record is counted
          from slips, never reported by the seller.
        </p>
      </header>

      {listings.error ? (
        <Empty title="The hub did not answer.">
          The registry lists the hub’s offers live. Check the hub is running, or open this page with{" "}
          <span className="mono">?hub=off</span> for fixture data.
        </Empty>
      ) : listings.loading && !listings.data ? (
        <div aria-busy="true" />
      ) : all.length === 0 ? (
        <Empty title="No offers on this hub yet.">
          Sellers appear here the moment a runner publishes an offer. <Link to="/seller/publish">Publish a skill</Link> to be
          the first.
        </Empty>
      ) : (
        <>
          <div className="filters" role="search">
            <div className="field filters__search">
              <label className="sr-only" htmlFor={searchId}>
                Search offers and sellers
              </label>
              <input
                id={searchId}
                className="input"
                type="search"
                placeholder="Search offers and sellers"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="segmented" role="group" aria-label="Adapter">
              {ADAPTERS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cx("segmented__item", adapter === a.id && "is-on")}
                  aria-pressed={adapter === a.id}
                  onClick={() => setAdapter(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="field filters__rail">
              <label className="sr-only" htmlFor={railId}>
                Rail
              </label>
              <select id={railId} className="input" value={rail} onChange={(e) => setRail(e.target.value as RailId | "all")}>
                <option value="all">All rails</option>
                {rails.map((r) => (
                  <option key={r} value={r}>
                    {RAIL_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="registry__count num" aria-live="polite">
            {groups.length} {groups.length === 1 ? "seller" : "sellers"} · {visible.length} {visible.length === 1 ? "offer" : "offers"} ·{" "}
            {online} online
          </p>

          {groups.length === 0 ? (
            <div className="registry__none">
              <p className="registry__none-title">{filtered ? "No offers match these filters." : "No offers."}</p>
              {filtered ? (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="sellers">
              {groups.map((g) => (
                <SellerBlock key={g.address} g={g} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SellerBlock({ g }: { g: SellerGroup }) {
  return (
    <section className="seller-block" aria-label={`Seller ${g.name}`}>
      <header className="seller-block__head">
        <div className="seller-block__who">
          <p className="seller-block__name">{g.name}</p>
          <Hash value={g.address} label={`${g.name} address`} />
        </div>
        <dl className="seller-block__facts">
          <div>
            <dt>Identity</dt>
            <dd className={g.agentId ? undefined : "is-quiet"}>
              {g.agentId ? <span className="num">ERC-8004 agent {g.agentId}</span> : "Not registered"}
            </dd>
          </div>
          <div>
            <dt>Record</dt>
            <dd className="num">
              {g.released + g.refunded + g.failed === 0
                ? "No calls yet"
                : `${g.released} paid · ${g.refunded} refunded${g.failed ? ` · ${g.failed} failed` : ""}`}
            </dd>
          </div>
          <div>
            <dt>Delivered</dt>
            <dd className="num">{deliveryRate(g.released, g.refunded)}</dd>
          </div>
        </dl>
      </header>
      <ul className="offer-list">
        {g.offers.map((l) => (
          <li key={l.hash} className={cx("offer-line", l.status === "delisted" && "is-delisted")}>
            <div className="offer-line__main">
              <p className="offer-line__title">
                <Link to={`/offer/${l.hash}`}>{l.offer.title}</Link>
                <Tag>{l.offer.adapter}</Tag>
              </p>
              <p className="offer-line__summary">{l.offer.summary}</p>
              <p className="offer-line__rails">
                {l.offer.rails.map((r) => (
                  <RailTag key={r} rail={r} />
                ))}
              </p>
            </div>
            <div className="offer-line__end">
              <Amount money={usd(l.offer.price, l.offer.rails[0])} size="md" />
              <span className={cx("offer-line__state", l.online === false && "is-off")}>
                {l.status === "delisted" ? `Delisted${l.reason ? `: ${l.reason}` : ""}` : l.online === undefined ? "" : l.online ? "Online" : "Offline"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
