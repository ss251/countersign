import { useId, useMemo, useState } from "react";
import type { AdapterKind, RailId } from "@countersign/core";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { ANONYMOUS, formatAgo, RAIL_LABEL, usd } from "../../lib/format.ts";
import { settlementIndex, type Ledger } from "../../lib/ledger.ts";
import { useNow } from "../../lib/now.ts";
import type { Listing, SellerRecord, Settlement } from "../../lib/types.ts";
import { AddressGlyph } from "../../ui/AddressGlyph.tsx";
import { Amount, Button, Empty, FixtureNote, Hash, RailState, Tag, cx } from "../../ui/primitives.tsx";
import { railGroups } from "./rails.ts";
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
  /**
   * Rails whose payee the seller's ENS name does not cover. The name locks EVM payees only,
   * so a Hedera account id, for one, is not checked against it.
   */
  outsideName?: string[];
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
        ...(r.name !== null ? { outsideName: payeesOutsideName(r.payees) } : {}),
      };
    })
    .sort((a, b) => b.released - a.released || a.name.localeCompare(b.name));
}

/** The rails whose payee is not an EVM address, so the ENS payee lock does not reach it. */
export function payeesOutsideName(payees: Partial<Record<string, string>>): string[] {
  return Object.entries(payees)
    .filter(([, payee]) => typeof payee === "string" && !/^0x[0-9a-fA-F]{40}$/.test(payee))
    .map(([rail]) => rail)
    .sort();
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

export { settlementIndex };

type RailGroups = NonNullable<ReturnType<typeof railGroups>>;

/**
 * The rail row: every offer rail on a hub whose rails are unknown, otherwise the same toggles
 * under the hub's live rails and the rails only offers name.
 */
export function RailFilters({
  groups,
  flat,
  rail,
  onRail,
  count,
}: {
  groups: RailGroups | null;
  flat: RailId[];
  rail: RailId | "all";
  onRail: (r: RailId | "all") => void;
  count: (r: RailId | "all") => number;
}) {
  const toggle = (r: RailId | "all") => (
    <button key={r} type="button" className={cx("toggle", rail === r && "is-on")} aria-pressed={rail === r} onClick={() => onRail(r)}>
      {r === "all" ? "Every rail" : RAIL_LABEL[r]} <span className="toggle__n num">{count(r)}</span>
    </button>
  );
  return (
    <div className="toggles" role="group" aria-label="Rail">
      {toggle("all")}
      {groups ? (
        <>
          <span className="label">{`Live (${groups.live.length})`}</span>
          {groups.live.map(toggle)}
          {groups.listed.length > 0 ? (
            <>
              <span className="label">{`Listed only (${groups.listed.length})`}</span>
              {groups.listed.map(toggle)}
            </>
          ) : null}
        </>
      ) : (
        flat.map(toggle)
      )}
    </div>
  );
}

/** How many recent settlements the Registry reads for its per-offer counts and last-settlement times. */
export const SETTLEMENT_PAGE = 100;

/** Every seller this hub knows and what each sells, with who they are and how they have delivered. */
export default function RegistryPage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const sellers = useResource(() => api.sellers(), []);
  const settlements = useResource(() => api.settlements(SETTLEMENT_PAGE), []);
  const hubRails = useResource(() => api.rails(), []);
  const now = useNow();
  const [text, setText] = useState("");
  const [adapter, setAdapter] = useState<AdapterFilter>("all");
  const [rail, setRail] = useState<RailId | "all">("all");
  const searchId = useId();

  const all = listings.data ?? [];
  const rails = useMemo(() => [...new Set(all.flatMap((l) => l.offer.rails))], [all]);
  const hubRailIds = hubRails.source === "hub" && hubRails.data ? hubRails.data.map((d) => d.id) : undefined;
  const railSets = railGroups(rails, hubRailIds);
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
          <div className="scard scard--skeleton" />
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
            <RailFilters groups={railSets} flat={rails} rail={rail} onRail={setRail} count={railCount} />
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
                <SellerCard
                  key={g.address}
                  g={g}
                  ledger={ledger}
                  now={now}
                  reading={sellers.loading && sellers.data === undefined}
                  ledgerComplete={Array.isArray(settlements.data) && settlements.data.length < SETTLEMENT_PAGE}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SellerCard({
  g,
  ledger,
  now,
  reading = false,
  ledgerComplete = true,
}: {
  g: SellerGroup;
  ledger: Ledger;
  now: number;
  /** The hub's seller records have not answered yet: a missing count is still loading, not absent. */
  reading?: boolean;
  /** The console's own settlements ledger holds every payment (fewer rows than it asked for), so its per-offer counts are whole. */
  ledgerComplete?: boolean;
}) {
  const last = ledger.lastBySeller.get(g.address);
  const calls = g.released + g.refunded + g.failed;
  const titleId = `seller-${g.address}`;
  return (
    <article className="scard" aria-labelledby={titleId}>
      <header className="scard__head">
        <AddressGlyph address={g.address} />
        <div className="scard__who">
          <h2 id={titleId} className={cx("scard__name", !g.named && "is-unnamed")}>
            {g.named ? g.name : ANONYMOUS}
            {g.agentId ? (
              <svg className="scard__tick" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="Identity proven by ERC-8004">
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </h2>
          <Hash value={g.address} head={8} tail={6} label={`${g.named ? g.name : "seller"} address`} />
          <p className="scard__id">{g.agentId ? <>ERC-8004 agent <span className="num">#{g.agentId}</span></> : "Not registered with ERC-8004"}</p>
          {g.outsideName && g.outsideName.length > 0 ? (
            <p className="scard__id">
              The ENS name locks EVM payees only. The {g.outsideName.join(" and ")} payee is not checked against it.
            </p>
          ) : null}
        </div>
      </header>

      <dl className="scard__strip">
        <div>
          <dt className="label">Record</dt>
          <dd className="num">{!g.counted ? (reading ? "Reading…" : "Not counted yet") : calls === 0 ? "No calls yet" : `${g.released} paid`}</dd>
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

      <ul className="scard__offers">
        {g.offers.map((l) => {
          // The hub's own per-offer count first; the console's ledger only when it is whole, since a truncated one undercounts.
          const c = (l.stats ? { paid: l.stats.released, refunded: l.stats.refunded } : undefined) ?? (ledgerComplete ? ledger.byOffer.get(l.hash.toLowerCase()) : undefined);
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
