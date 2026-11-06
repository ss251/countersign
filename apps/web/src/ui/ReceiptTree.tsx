import { Link } from "../app/router.tsx";
import { RAIL_LABEL, usd } from "../lib/format.ts";
import type { TreeView } from "../lib/types.ts";
import { Amount, Hash, cx } from "./primitives.tsx";
import "./tree.css";

/**
 * A receipt tree (STEER-2235 item 5). When a seller buys from other sellers to serve a call, each purchase gets
 * its own slip. Two kinds of branch are drawn, and never confused:
 * - signed: the hash sits in the parent slip's body.children, so the seller committed it and it cannot be
 *   dropped or added afterwards (a solid line);
 * - the hub's record: the inner call named this job in its lineage, so the hub saw it bought inside the job,
 *   but the seller's slip does not sign it (a dashed line, said in words).
 * A signed child this hub does not hold is shown as missing.
 */
export function ReceiptTree({ tree, current }: { tree: TreeView; current?: string }) {
  const observedAny = Object.values(tree.nodes).some((n) =>
    (n.observed ?? []).some((h) => !n.slip.body.children.some((c) => c.toLowerCase() === h.toLowerCase())),
  );
  return (
    <div className="tree-wrap">
      <ul className="tree" role="tree" aria-label="Receipt tree">
        <Node tree={tree} hash={tree.root} current={current} depth={0} seen={new Set()} kind="signed" />
      </ul>
      <p className="tree__legend">
        <span className="tree__key tree__key--signed" aria-hidden="true" />
        Signed into the parent's slip: it cannot be dropped or added after the seller signs.
        {observedAny ? (
          <>
            <br />
            <span className="tree__key tree__key--observed" aria-hidden="true" />
            The hub's record of a purchase made inside the job, which the seller's slip does not sign.
          </>
        ) : null}
      </p>
    </div>
  );
}

type Kind = "signed" | "observed";

function Node({
  tree,
  hash,
  current,
  depth,
  seen,
  kind,
}: {
  tree: TreeView;
  hash: string;
  current?: string;
  depth: number;
  seen: Set<string>;
  kind: Kind;
}) {
  const node = tree.nodes[hash];
  if (!node || seen.has(hash)) {
    const missing = (tree.missing ?? []).some((m) => m.toLowerCase() === hash.toLowerCase());
    return (
      <li className={cx("tree__node", kind === "observed" && "tree__node--observed")} role="treeitem" aria-level={depth + 1}>
        <div className={cx("tree__row", kind === "signed" && "tree__row--missing")} data-kind={kind}>
          <span className="tree__main">
            {kind === "observed" ? (
              <Link to={`/slip/${hash}`} className="tree__title">
                A purchase inside this job
              </Link>
            ) : (
              <span className="tree__title">{missing ? "Signed into this slip, but not held by this hub" : "Slip not available"}</span>
            )}
            {kind === "observed" ? <span className="tree__meta">The hub's record, not signed by the seller</span> : null}
          </span>
          <Hash value={hash} label="slip hash" />
        </div>
      </li>
    );
  }
  const next = new Set(seen).add(hash);
  const { slip, title, sellerName } = node;
  const children = slip.body.children;
  const observed = (node.observed ?? []).filter((h) => !children.some((c) => c.toLowerCase() === h.toLowerCase()));
  const here = current?.toLowerCase() === hash.toLowerCase();
  const branches = children.length + observed.length;
  return (
    <li
      className={cx("tree__node", kind === "observed" && "tree__node--observed")}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={branches ? true : undefined}
    >
      <div className={cx("tree__row", here && "tree__row--current")} data-kind={kind}>
        <span className="tree__main">
          {here ? (
            <span className="tree__title">{title}</span>
          ) : (
            <Link to={`/slip/${hash}`} className="tree__title">
              {title}
            </Link>
          )}
          <span className="tree__meta">
            {kind === "observed" ? `The hub's record, not signed by the seller · ${sellerName}` : `${sellerName} · ${RAIL_LABEL[slip.body.rail]}`}
          </span>
        </span>
        <Amount money={usd(slip.body.amount, slip.body.rail)} size="sm" />
        <Hash value={hash} label={`${title} slip hash`} />
      </div>
      {branches ? (
        <ul className="tree__children" role="group">
          {children.map((c) => (
            <Node key={c} tree={tree} hash={c} current={current} depth={depth + 1} seen={next} kind="signed" />
          ))}
          {observed.map((c) => (
            <Node key={c} tree={tree} hash={c} current={current} depth={depth + 1} seen={next} kind="observed" />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
