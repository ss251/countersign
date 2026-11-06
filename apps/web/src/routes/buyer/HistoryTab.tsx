import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatAmount, formatDay, formatTime, RAIL_LABEL } from "../../lib/format.ts";
import type { Money, Purchase } from "../../lib/types.ts";
import { Amount, cx, Empty, Status } from "../../ui/primitives.tsx";

/** Every call the agent made, newest first. Refused and refunded calls cost nothing. */
export function HistoryTab() {
  const history = useResource(() => api.history(), []);
  if (!history.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;
  if (history.data.length === 0) {
    return <Empty title="No purchases yet.">When your agent buys, each call shows here with its slip.</Empty>;
  }

  const groups = groupByDay(history.data);
  const today = groups[0]?.day === "Today" ? groups[0] : undefined;

  return (
    <div className="history">
      {today ? (
        <p className="history__summary">
          Today: <Amount money={spent(today.items)} size="sm" /> across{" "}
          <span className="num">{today.items.length}</span> calls,{" "}
          <span className="num">{today.items.filter((p) => p.status === "released").length}</span> released.
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.day} className="history__day" aria-label={g.day}>
          <h2 className="history__day-title">{g.day}</h2>
          <ul className="history__list">
            {g.items.map((p) => (
              <li key={p.id}>
                <Row p={p} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ p }: { p: Purchase }) {
  const voided = p.status === "refused" || p.status === "refunded";
  const body = (
    <>
      <span className="hrow__main">
        <span className="hrow__name">{p.offerName}</span>
        <span className="hrow__meta">
          {p.seller.name} · {RAIL_LABEL[p.rail]}
          {p.approvedBy === "you" ? " · you approved" : ""}
        </span>
        {p.reason ? <span className={cx("hrow__reason", p.status === "refused" && "hrow__reason--refused")}>{p.reason}</span> : null}
      </span>
      <span className="hrow__end">
        <Amount money={p.amount} size="sm" className={voided ? "amount--void" : undefined} />
        <span className="hrow__status">
          <Status status={p.status} /> <time className="num" dateTime={p.at}>{formatTime(p.at)}</time>
        </span>
      </span>
    </>
  );
  return p.slipId ? (
    <Link
      to={`/slip/${p.slipId}`}
      className="hrow hrow--link"
      aria-label={`${p.offerName}, ${formatAmount(p.amount)} ${p.amount.asset.symbol}, ${p.status}. Open the slip.`}
    >
      {body}
    </Link>
  ) : (
    <div className="hrow">{body}</div>
  );
}

function groupByDay(items: Purchase[]) {
  const out: Array<{ day: string; items: Purchase[] }> = [];
  for (const p of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const day = formatDay(p.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(p);
    else out.push({ day, items: [p] });
  }
  return out;
}

function spent(items: Purchase[]): Money {
  const asset = items[0]?.amount.asset ?? { symbol: "USDC", decimals: 6 };
  const total = items
    .filter((p) => p.status === "released" && p.amount.asset.symbol === asset.symbol)
    .reduce((sum, p) => sum + BigInt(p.amount.amount), 0n);
  return { amount: total.toString(), asset };
}
