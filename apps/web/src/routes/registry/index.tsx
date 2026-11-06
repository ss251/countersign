import { useId, useMemo, useState } from "react";
import type { AdapterKind, RailId } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatAgo, RAIL_LABEL, usd } from "../../lib/format.ts";
import { useNow } from "../../lib/now.ts";
import type { Listing, SellerRecord, Settlement } from "../../lib/types.ts";
import { AddressGlyph } from "../../ui/AddressGlyph.tsx";
import { Amount, Button, Empty, FixtureNote, Hash, RailState, Tag, cx } from "../../ui/primitives.tsx";
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
  /** Whether anything has counted this seller's calls yet: slips in fixtures, or the hub's /sellers. */
  counted: boolean;
  /** False when the hub has no name for this seller. */
  named: boolean;
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
        counted: true,
        named: r.name !== null || g.named,
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
      ({
        address,
        name: l.seller.name,
        agentId: l.seller.agentId,
        offers: [],
        released: 0,
        refunded: 0,
        failed: 0,
        online: 0,
        counted: false,
        named: l.seller.named !== false,
      } satisfies SellerGroup);
    g.offers.push(l);
    if (l.stats) g.counted = true;
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
  const settlements = useResource(() => api.settlements(100), []);
  const now = useNow();
  const [text, setText] = useState("");
  const [adapter, setAdapter] = useState<AdapterFilter>("all");
  const [rail, setRail] = useState<RailId | "all">("all");
  const searchId = useId();

  const all = listings.data ?? [];
  const rails = useMemo(() => [...new Set(all.flatMap((l) => l.offer.rails))], [all]);
  // Counts on every toggle reflect the other filters, so a toggle never promises rows it cannot show.
  const adapterCount = (a: AdapterFilter) => all.filter((l) => matches(l, text, a, rail)).length;
  const railCount = (r: RailId | "all") => all.filter((l) => matches(l, text, adapter, r)).length;
  const visible = all.filter((l) => matches(l, text, adapter, rail));
  const groups = withRecords(groupBySeller(visible), sellers.data);
  const filtered = Boolean(text.trim()) || adapter !== "all" || rail !== "all";
  const online = visible.filter((l) => l.online).length;
  const ledger = settlementIndex(settlements.data);
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
          An offer is a price and two schemas; the code behind it stays on the seller’s machine. Every record below is counted
          from slips, never reported by the seller.
        </p>
      </header>

      {listings.error ? (
        <Empty title="The hub did not answer.">
          The registry lists the hub’s offers live. Check the hub is running, or open this page with{" "}
          <span className="mono">?hub=off</span> for fixture data.
        </Empty>
      ) : listings.loading && !listings.data ? (
        <div className="sellers" aria-busy="true">
          <div className="seller seller--skeleton" />
        </div>
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
            <div className="toggles" role="group" aria-label="Adapter">
              {ADAPTERS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cx("toggle", adapter === a.id && "is-on")}
                  aria-pressed={adapter === a.id}
                  onClick={() => setAdapter(a.id)}
                >
                  {a.label} <span className="toggle__n num">{adapterCount(a.id)}</span>
                </button>
              ))}
            </div>
            <div className="toggles" role="group" aria-label="Rail">
              <button type="button" className={cx("toggle", rail === "all" && "is-on")} aria-pressed={rail === "all"} onClick={() => setRail("all")}>
                Every rail <span className="toggle__n num">{railCount("all")}</span>
              </button>
              {rails.map((r) => (
                <button key={r} type="button" className={cx("toggle", rail === r && "is-on")} aria-pressed={rail === r} onClick={() => setRail(r)}>
                  {RAIL_LABEL[r]} <span className="toggle__n num">{railCount(r)}</span>
                </button>
              ))}
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
                <SellerCard key={g.address} g={g} ledger={ledger} now={now} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* The settlements, indexed the two ways a seller card reads them. */

interface Ledger {
  /** null when the hub does not list settlements: say nothing rather than "none". */
  known: boolean;
  lastBySeller: Map<string, Settlement>;
  byOffer: Map<string, { paid: number; refunded: number }>;
}

export function settlementIndex(rows: Settlement[] | null | undefined): Ledger {
  const lastBySeller = new Map<string, Settlement>();
  const byOffer = new Map<string, { paid: number; refunded: number }>();
  for (const s of rows ?? []) {
    const seller = s.seller.toLowerCase();
    if (!lastBySeller.has(seller)) lastBySeller.set(seller, s);
    const key = s.offerHash.toLowerCase();
    const c = byOffer.get(key) ?? { paid: 0, refunded: 0 };
    if (s.kind === "refunded") c.refunded += 1;
    else c.paid += 1;
    byOffer.set(key, c);
  }
  return { known: Array.isArray(rows), lastBySeller, byOffer };
}

function SellerCard({ g, ledger, now }: { g: SellerGroup; ledger: Ledger; now: number }) {
  const last = ledger.lastBySeller.get(g.address);
  const calls = g.released + g.refunded + g.failed;
  const titleId = `seller-${g.address}`;
  return (
    <article className="seller" aria-labelledby={titleId}>
      <header className="seller__head">
        <AddressGlyph address={g.address} />
        <div className="seller__who">
          <h2 id={titleId} className={cx("seller__name", !g.named && "is-unnamed")}>
            {g.named ? g.name : "Unnamed seller"}
            {g.agentId ? (
              <svg className="seller__tick" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="Identity proven by ERC-8004">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </h2>
          <Hash value={g.address} head={8} tail={6} label={`${g.named ? g.name : "seller"} address`} />
          <p className="seller__id">{g.agentId ? <>ERC-8004 agent <span className="num">#{g.agentId}</span></> : "Not registered with ERC-8004"}</p>
        </div>
      </header>

      <dl className="seller__strip">
        <div>
          <dt className="label">Record</dt>
          <dd className="num">{!g.counted ? "Not counted yet" : calls === 0 ? "No calls yet" : `${g.released} paid`}</dd>
        </div>
        <div>
          <dt className="label">Delivered</dt>
          <dd className="num">{g.counted ? deliveryRate(g.released, g.refunded + g.failed) : "—"}</dd>
        </div>
        <div>
          <dt className="label">Refunded</dt>
          <dd className="num">{g.counted ? g.refunded : "—"}</dd>
        </div>
        <div>
          <dt className="label">Last settlement</dt>
          <dd className="num">{last ? formatAgo(last.at, now) : ledger.known ? "None yet" : "—"}</dd>
        </div>
      </dl>

      <ul className="seller__offers">
        {g.offers.map((l) => {
          const c = ledger.byOffer.get(l.hash.toLowerCase()) ?? (l.stats ? { paid: l.stats.released, refunded: l.stats.refunded } : undefined);
          return (
            <li key={l.hash} className={cx("orow", l.status === "delisted" && "is-delisted")}>
              <div className="orow__main">
                <p className="orow__title">
                  <Link to={`/offer/${l.hash}`}>{l.offer.title}</Link>
                  <Tag>{l.offer.adapter}</Tag>
                </p>
                <p className="orow__summary" title={l.offer.summary}>
                  {l.offer.summary}
                </p>
              </div>
              <p className="orow__rails">{l.offer.rails.map((r) => RAIL_LABEL[r]).join(", ")}</p>
              <p className="orow__state num">
                {l.status === "delisted" ? (
                  <span className="orow__delisted">Delisted{l.reason ? `: ${l.reason}` : ""}</span>
                ) : l.online === undefined ? null : (
                  <RailState state={l.online ? "live" : "off"}>{l.online ? "Online" : "Offline"}</RailState>
                )}
                {c ? <span className="orow__calls">{c.paid} paid{c.refunded ? ` · ${c.refunded} refunded` : ""}</span> : null}
              </p>
              <p className="orow__price">
                <Amount money={usd(l.offer.price, l.offer.rails[0])} size="sm" />
              </p>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
