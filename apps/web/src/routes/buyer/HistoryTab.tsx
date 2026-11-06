import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { formatAmount, formatDay, formatTime, RAIL_LABEL, symbolFor, usd } from "../../lib/format.ts";
import type { Purchase } from "../../lib/types.ts";
import { Amount, cx, Empty, Status } from "../../ui/primitives.tsx";

/** Every call the agent made, newest first. Refused and refunded calls cost nothing. */
export function HistoryTab() {
  const purchases = useResource(() => api.purchases(), []);
  if (!purchases.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;
  if (purchases.data.length === 0) {
    return <Empty title="No purchases yet.">When your agent buys, each call shows here with its slip.</Empty>;
  }

  const groups = groupByDay(purchases.data);
  const today = groups[0]?.day === "Today" ? groups[0] : undefined;
  const todayUsdc = today?.items.filter((p) => p.status === "released" && symbolFor(p.rail) === "USDC") ?? [];

  return (
    <div className="history">
      {today ? (
        <p className="history__summary">
          Today <Amount money={usd(todayUsdc.reduce((s, p) => s + BigInt(p.amount), 0n))} size="sm" /> settled across{" "}
          <span className="num">{today.items.length}</span> calls.
        </p>
      ) : null}
      {groups.map((g) => (
        <section key={g.day} className="history__day" aria-label={g.day}>
          <h2 className="history__day-title">{g.day}</h2>
          <ul className="history__list">
            {g.items.map((p) => (
              <li key={p.jobId}>
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
  const money = usd(p.amount, p.rail);
  const voided = p.status === "refused" || p.status === "refunded";
  const body = (
    <>
      <span className="hrow__main">
        <span className="hrow__name">{p.title}</span>
        <span className="hrow__meta">
          {p.seller.name} · {RAIL_LABEL[p.rail]}
          {p.approvedBy === "you" ? " · you countersigned" : ""}
        </span>
        {p.reason ? <span className={cx("hrow__reason", p.status === "refused" && "hrow__reason--refused")}>{p.reason}</span> : null}
      </span>
      <span className="hrow__end">
        <Amount money={money} size="sm" className={voided ? "amount--void" : undefined} />
        <span className="hrow__status">
          <Status status={p.status} />{" "}
          <time className="num" dateTime={new Date(p.at * 1000).toISOString()}>
            {formatTime(p.at)}
          </time>
        </span>
      </span>
    </>
  );
  return p.slipHash ? (
    <Link
      to={`/slip/${p.slipHash}`}
      className="hrow hrow--link"
      aria-label={`${p.title}, ${formatAmount(money)} ${money.asset.symbol}, ${p.status}. Open the slip.`}
    >
      {body}
    </Link>
  ) : (
    <div className="hrow">{body}</div>
  );
}

function groupByDay(items: Purchase[]) {
  const out: Array<{ day: string; items: Purchase[] }> = [];
  for (const p of [...items].sort((a, b) => b.at - a.at)) {
    const day = formatDay(p.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(p);
    else out.push({ day, items: [p] });
  }
  return out;
}
