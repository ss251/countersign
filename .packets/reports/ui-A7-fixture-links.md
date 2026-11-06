# ui-A7-fixture-links report

## What was built

The route stayed as decided: fixture slips are labelled sample data and never get an explorer link. Fixture addresses were not swapped for real ones, so the signed fixture slips in `apps/web/test/verify.test.ts` still verify.

- `apps/web/src/lib/verify.ts`: added `explorerFor(slip, fromFixtures)`. It returns `undefined` for fixture data; otherwise it returns the existing `explorerTemplate(network)` URL with `encodeURIComponent(tx)`, or `undefined` when the network has no template.
- `apps/web/src/lib/verify.ts`, `case "onchain"`: `href` is now set only on the passing branch (`f.ok && hashOk`), where the chain read found this job's `Released` event carrying the slip hash. Both failing branches keep `value: tx` but omit `href`.
- `apps/web/src/routes/verify/index.tsx`: the page tracks provenance alongside the slip on screen. It is fixture data when `api.slip(hash)` answered with `source === "fixtures"`, when the fixture example is loaded, or when that same fixture slip is re-checked without changing its hash. Pasted slips, opened files and hub slips are not fixture data. The `Verdict` `chain` prop receives `explorerFor(current, fromFixtures)`, so "Open on the explorer" does not render for fixture slips.
- Left alone as instructed: `RailCard`'s existing `link` guard (the slip page already passes `link={view.source !== "fixtures"}`), the landing, and `apps/web/src/routes/merchant/**`.

## Tests

`apps/web/test/fixture-links.test.ts` runs with no browser and no network:

- **Every fixture address and transaction.** Collects every exact 40- or 64-hex-digit `0x` value from `apps/web/src/fixtures/catalogue.json`, `signed-slip.json` and `index.ts`, and checks that all three files contribute values and that every countersign slip's settlement transaction is in the set.
- **The verdict.** For every countersign slip in `fixtures.slips`, `verifySlip(slip)` runs offline and no check's `href` contains any collected fixture value.
- **The page's explorer.** For each such slip, `explorerFor(slip, true)` is `undefined` and `explorerFor(slip, false)` is an `https://` URL containing the encoded transaction.
- **The rail card.** `RailCard` is rendered with `renderToString` for every fixture rail declaration, a fixture transaction and `link={false}`; no `href` contains any collected fixture value.
- **The passing branch keeps its link: skipped.** The on-chain mapping (`present`) is private to `apps/web/src/lib/verify.ts`, and the existing web verify tests either run offline or read Arc testnet live under `CS_LIVE=1`; neither exposes a way to construct a passing `onchain` finding. The packet allows skipping this point in that case rather than mocking the RPC or exporting the internal mapping only for a test.

## Acceptance

From the worktree root:

```
$ bun install --linker hoisted && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
bun install v1.3.14 (0d9b296a)

Checked 870 installs across 668 packages (no changes) [154.00ms]
$ tsc -p tsconfig.json
bun test v1.3.14 (0d9b296a)

 166 pass
 3 skip
 0 fail
 816 expect() calls
Ran 169 tests across 15 files. [2.18s]
vite v8.3.6 building client environment for production...
transforming...
[plugin rolldown:vite-resolve] Module "node:worker_threads" has been externalized for browser compatibility, imported by ".../node_modules/ox/_esm/tempo/internal/virtualMasterPool.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.
✓ 4974 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                               2.47 kB │ gzip:   0.88 kB
dist/assets/index-DaNfkhRd.css              105.92 kB │ gzip:  19.59 kB
... (build asset list omitted)
dist/assets/index-Cjb8FAsL.js               505.95 kB │ gzip: 151.06 kB │ map: 2,095.42 kB

✓ built in 1.67s
```

The three skipped tests are the existing `CS_LIVE=1` Arc testnet suite; `apps/web/test/verify.test.ts` passes, including "every signed fixture slip is valid".

## Not done / notes

- No browser of any kind was launched. The visual behaviour of the hidden "Open on the explorer" action was not exercised in a browser; the guard is covered by the pure helper and render tests above. Any further UI check belongs to the lane as NEEDS-BROWSER.
- No files outside the lease were changed: `packages/**`, `apps/hub/**`, `apps/web/src/fixtures/**` and `apps/web/src/routes/merchant/**` are untouched.
- Nothing was pushed, merged or deployed.
