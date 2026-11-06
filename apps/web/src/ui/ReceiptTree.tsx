import { Link } from "../app/router.tsx";
import { RAIL_LABEL, usd } from "../lib/format.ts";
import type { TreeView } from "../lib/types.ts";
import { Amount, Hash, cx } from "./primitives.tsx";
import "./tree.css";

/**
 * A receipt tree. When a seller buys from other sellers to serve a call, each purchase
 * gets its own slip, and the outer slip’s body lists their hashes. The root commits its
 * children, so no purchase can be dropped or added after the seller signs.
 */
export function ReceiptTree({ tree, current }: { tree: TreeView; current?: string }) {
  return (
    <ul className="tree" role="tree" aria-label="Receipt tree">
      <Node tree={tree} hash={tree.root} current={current} depth={0} seen={new Set()} />
    </ul>
  );
}

function Node({ tree, hash, current, depth, seen }: { tree: TreeView; hash: string; current?: string; depth: number; seen: Set<string> }) {
  const node = tree.nodes[hash];
  if (!node || seen.has(hash)) {
    return (
      <li className="tree__node" role="treeitem" aria-level={depth + 1}>
        <div className="tree__row tree__row--missing">
          <span className="tree__title">Slip not available</span>
          <Hash value={hash} label="slip hash" />
        </div>
      </li>
    );
  }
  const next = new Set(seen).add(hash);
  const { slip, title, sellerName } = node;
  const children = slip.body.children;
  const here = current?.toLowerCase() === hash.toLowerCase();
  return (
    <li className="tree__node" role="treeitem" aria-level={depth + 1} aria-expanded={children.length ? true : undefined}>
      <div className={cx("tree__row", here && "tree__row--current")}>
        <span className="tree__main">
          {here ? (
            <span className="tree__title">{title}</span>
          ) : (
            <Link to={`/slip/${hash}`} className="tree__title">
              {title}
            </Link>
          )}
          <span className="tree__meta">
            {sellerName} · {RAIL_LABEL[slip.body.rail]}
          </span>
        </span>
        <Amount money={usd(slip.body.amount, slip.body.rail)} size="sm" />
        <Hash value={hash} label={`${title} slip hash`} />
      </div>
      {children.length ? (
        <ul className="tree__children" role="group">
          {children.map((c) => (
            <Node key={c} tree={tree} hash={c} current={current} depth={depth + 1} seen={next} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
