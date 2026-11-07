# cs-83-e2e-envelope-step-layout report

## The change

Only `e2e/human/tests/buy.spec.ts`, step 11 ("envelope-tab"), was touched.

- Lines 743-752 (replacing the old unconditional tab-bar click at former lines 743-746): step 11 now
  resolves the Buyer tab bar and the page's envelope card up front, waits until at least one of them is
  visible within 30 s, and then picks whichever the page offers. If the tab bar is visible it clicks the
  envelope link there and notes "envelope opened from the Buyer tab bar". Otherwise it clicks the card's
  `View` / `Edit limits` link and notes "envelope opened from the page's envelope card (the tab bar is
  phone-only)".
- Lines 753-759 are unchanged: the Budget region must be visible within 30 s, the URL hash must still
  start with `#/buyer`, and the envelope note with the hours is still recorded.

```ts
const nav = page.getByRole("navigation", { name: "Buyer" });
const card = page.getByRole("region", { name: "Your envelope" });
await expect(nav.or(card).first()).toBeVisible({ timeout: 30_000 });
if (await nav.isVisible()) {
  await nav.getByRole("link", { name: /envelope/i }).click();
  rec.note("envelope opened from the Buyer tab bar");
} else {
  await card.getByRole("link", { name: /^(view|edit limits)$/i }).click();
  rec.note("envelope opened from the page's envelope card (the tab bar is phone-only)");
}
```

No other hunk appears in `git diff`. No browser was launched; `--list` only, no test run, no
`playwright install`. No key, Privy login or token was read or printed. No `git stash` was used.

## Gate outputs

1. `bun install --linker hoisted && bun run typecheck`

```
749 packages installed [6.63s]
$ tsc -p tsconfig.json
```

(clean; no diagnostics)

2. `bun test e2e/human/test`

```
 76 pass
 0 fail
 204 expect() calls
Ran 76 tests across 10 files. [2.02s]
```

`bun test e2e/test`

```
 60 pass
 0 fail
 142 expect() calls
Ran 60 tests across 4 files. [8.58s]
```

3. `cd e2e && npx playwright test -c human/playwright.config.ts --list`

```
Listing tests:
  [privy] › buy.spec.ts:794:16 › the human acceptance run
  [injected] › buy.spec.ts:794:16 › the human acceptance run
Total: 2 tests in 1 file
```

4. `git status --short e2e/human/runs`

```
(no output)
```

Note: running the e2e test suites flipped the mode bit of `packages/cli/src/bin.ts` to 100755 (a test
side effect, no content change). It was restored to 100644 with `chmod`, so `git status --short` now
shows only `M e2e/human/tests/buy.spec.ts`.
