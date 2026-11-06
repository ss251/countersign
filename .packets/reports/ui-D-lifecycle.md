# ui-D-lifecycle report

## What was built

`apps/web/src/routes/home/Lifecycle.tsx` adds `LifecycleStage`: the landing's third stage follows
the newest real escrow release through the four beats `An offer is published.`, `A buyer
countersigns it.`, `The money is held until the work lands.` and `The seller signs, and the slip
verifies.`

- The offer and the slip are read inside the stage with `api.listing` and `api.slip` through
  `useResource`. A read whose `source` is not `"hub"` is treated as absent, so fixtures never
  reach this stage.
- The buyer is `release.buyer`, falling back to `slip.body.buyer`. The escrow address is the
  hub's `escrow` rail declaration, linked on Arcscan. The release transaction links to
  `https://testnet.arcscan.app/tx/<tx>`.
- Step 4 runs `verifySlip(slip)` from `lib/verify.ts`, the same offline verifier the verify page
  uses. It says `Checking…` while the read runs, `Verified in this browser` in green when the
  verdict is valid, and `Not verified:` with the first failing check otherwise.
- The four steps carry `is-on`, `is-done` (number followed by `✓`) and `is-next`, and all fade
  in the exit beat. Focus landing in a step calls `bring()` so its beat comes into view.
- Without a release, or with `hubDown`, the stage pins as one beat with one honest sentence and
  no steps: no fixture, no sample hash. Under reduced motion the four beats are static sections
  and the exit is not a section.
- `Settlement` gained the optional `buyer` field the hub already sends. The landing renders the
  stage between `ClearsStage` and `Proof`.

Files changed:

- `apps/web/src/routes/home/Lifecycle.tsx` (new)
- `apps/web/src/routes/home/index.tsx` (import and one render line)
- `apps/web/src/routes/home/landing.css` (appended `life` styles, tokens only)
- `apps/web/src/lib/types.ts` (`Settlement.buyer?`)
- `apps/web/test/lifecycle.test.ts` (new)

## Tests

`apps/web/test/lifecycle.test.ts` server-renders the stage with `react-dom/server`; it makes no
network or browser calls. It covers the four statements and four steps with a release, the
hub-down sentence and no steps, the no-release sentence, and four static sections with no exit
section under reduced motion.

## Acceptance output

```
$ bun install
bun install v1.3.14 (0d9b296a)

Checked 259 installs across 277 packages (no changes) [105.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/web/test
 146 pass
 3 skip
 0 fail
 724 expect() calls
Ran 149 tests across 11 files. [1233.00ms]

$ (cd apps/web && bunx --bun vite build)
✓ built in 2.64s
```

## Not done

No browser of any kind was launched, as required. Everything in the packet was built; nothing
outside the lease was touched. No pushes, merges or deploys.
