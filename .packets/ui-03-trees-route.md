# ui-03-trees-route: GET /trees/:root returns the receipt tree from real slips, and the console reads it from that route (refs #18)

## Setup

Run `bun install --linker hoisted` at the worktree root before anything else. You are on `cs/ui-03`, cut from `cs/int`.

## The design is decided (cs-ui)

The closure list's acceptance, in the captain's words, with no widening: `GET /trees/:root` returns the receipt tree from real slips, and the console's slip view draws it from that route, not from sample data. There is a test.

**What exists today:**
- The hub serves one slip at a time at `GET /slips/:slipHash` (`apps/hub/src/app.ts`, beside `/slips`), from `deps.store.getSlip(hash)`.
- A slip names its child slips in `slip.body.children` (hashes).
- The console builds the tree itself in `treeView(root)` in `apps/web/src/lib/api.ts`. It fetches each slip with `slipView` and recurses into `body.children`, depth-limited to 8.
- The slip view draws whatever `api.tree(root)` returns, as `TreeView` (`apps/web/src/lib/types.ts`): `{ root, nodes: { [hash]: { slip, title, sellerName } } }`. The view does not change in this packet.

### 1. The hub route (`apps/hub/src/app.ts`)

Add `GET /trees/:root` right after `GET /slips/:slipHash`:

- **Unknown root.** Read the root with `deps.store.getSlip(root)`. If absent, answer `404` `unknown-slip` "Refused. That slip is not known.", the same as `/slips`.
- **The walk.** Walk `body.children` breadth-first from the root:
  - visit each hash at most once, so a cycle can never loop;
  - stop below depth 8 (the root is depth 0), and at 256 nodes in all.
- **Each node:** `{ slip, title, sellerName }`.
  - `title` is the stored offer's title for `slip.body.offerHash`, from the offer store `GET /offers/:offerHash` uses. With no stored offer, it is `offer ` plus the short hash.
  - `sellerName` is the short form of `slip.body.seller`.
  - The short form is the first 6 characters, `…`, then the last 4. That is what the console's `shortHex` gives, so titles read the same as today.
- **Missing children.** A child hash the hub does not hold goes into `missing` (a list of hashes) and is not a node.
- **The response:** `{ root, nodes, missing }`. Hashes are exactly as stored. It answers 200 with CORS, like every other read.

### 2. The console reads the route (`apps/web/src/lib/api.ts`)

- Replace the client-side walk in `treeView(root)` with one `hubGet` of `/trees/${root}`, returning its `{ root, nodes }` as `TreeView`.
- A `404` from the route gives `{ root, nodes: {} }`, exactly what the walk returned for an unknown root today. Any other error throws, as other reads do.
- `TreeView` gains the optional `missing?: string[]`, carried through and otherwise unused.
- The fixtures path (`?hub=off`) is unchanged.

## Lease

You may create or change only:

- `apps/hub/src/app.ts`: the new route, nothing else;
- `apps/hub/test/trees.test.ts` (new);
- `apps/web/src/lib/api.ts`: `treeView` only;
- `apps/web/src/lib/types.ts`: `TreeView` only;
- `apps/web/test/tree.test.ts` (new);
- `.packets/reports/ui-03-trees-route.md`.

## Tests

No network.

1. **Hub (`apps/hub/test/trees.test.ts`).** Store slips with `hub.store.putSlip(slip.hash, jobId, slip, NOW)`, as `apps/hub/test/buyerplumbing.test.ts` does, and build the slips the way that file does. Cover:
   - a root with two children, one of which has its own child: all four are nodes, each with the stored offer's title;
   - a child hash the hub does not hold is in `missing` and not in `nodes`;
   - a cycle, where a child names the root: every slip appears once and the request returns;
   - a chain deeper than 8 stops at depth 8;
   - an unknown root answers 404 `unknown-slip`.
2. **Console (`apps/web/test/tree.test.ts`).** Stub `globalThis.window` with a `location.hash` of `#/?hub=http://hub.test`, an in-memory `localStorage`, and `globalThis.fetch`. Show that:
   - `api.tree(root)` makes exactly one request, to `http://hub.test/trees/<root>`, and returns the route's nodes;
   - a 404 gives the empty tree.
3. Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No view code:** nothing under `apps/web/src/routes/**` or `apps/web/src/ui/**`.
- TypeScript strict, no `any`. No new dependencies. Never deploy, never use a public RPC in tests.
- Never run `git stash`; use a temporary commit or a second worktree. All worktrees of a clone share one stash stack, on both machines.

## Acceptance

From the worktree root:

```
bun install --linker hoisted && bun run typecheck && bun test apps/hub apps/web/test && bun test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #18)`, and no trailers. Write `.packets/reports/ui-03-trees-route.md`. Do not push, merge or deploy.
