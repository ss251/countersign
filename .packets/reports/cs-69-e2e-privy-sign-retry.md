# cs-69-e2e-privy-sign-retry: retry Privy's signature as its error asks, and keep the browser console

Status: complete on `cs/cs-69` on top of `cs/cs-68` (`4a09638`). No browser was launched, no
acceptance run was started, and no key or Privy login was read or printed. Playwright was called
with `--list` only, and `playwright install` was not run.

## The change

### `e2e/human/lib/privy.ts`

- **6-8:** imports `appendFileSync`, `mkdirSync`, `writeFileSync` and `dirname` for the console
  artifact.
- **133-145:** `recordPrivyConsole(page, file)` creates the local console file and appends one JSON
  line per event: `{ type, text }` for every page console message, with the text cut to 500
  characters, and `{ type: "pageerror", text }` for every page error. It listens only to `console`
  and `pageerror`; no request or response body is written.
- **147-159:** the sign-button and error regexes, the 15 s outcome window, the 2 s retry delay, the
  three-click limit, the exact failure message, and `privySignatureNote(clicks)`, which renders
  `Privy's signature needed <n> clicks: "An error has occurred, please try again" (UX gap, cs-ui)`.
- **161-195:** `visibleSignButton` finds the first visible `/^(sign|approve|confirm)/i` button
  inside `page.getByRole("dialog")`. `waitForPromptOutcome` polls for up to 15 s and returns
  `closed` when the button is no longer visible, `error` when the dialog shows
  `/an error has occurred|please try again/i`, or `open` when neither happens.
- **197-222:** `approveIfPrompted` now returns the number of clicks a prompt took (`0` when no
  prompt appeared). After an error, it waits 2 s and clicks the still-visible button again, for at
  most three clicks. A third error throws
  `Privy could not sign: "An error has occurred, please try again" after 3 tries`.

### `e2e/human/tests/buy.spec.ts`

- **23-32:** imports `privySignatureNote` and `recordPrivyConsole`.
- **186-189:** `approveAndNote` calls `approveIfPrompted`, and when the prompt took more than one
  click adds the run note with that click count.
- **277-282:** the `privy` project records its console and page errors into
  `artifacts/<run>/privy/console.log`, adds that local file to the run's artifacts, and installs
  the existing Privy outage watcher. The workflow still uploads only `artifacts/*/injected/`, so
  the Privy console log is never uploaded. It is a text artifact, so the existing leak scan still
  covers it.
- **410-412:** both signature prompts now go through `approveAndNote`.

### `e2e/human/test/privy.test.ts`

- **3-9:** imports `approveIfPrompted`.
- **241-295:** a fake dialog models a prompt whose button stays active over the error for the first
  `errors` clicks, then closes. Its fake `waitForTimeout` records waits instead of sleeping, so the
  tests are browser-free and fast.
- **297-334:** the three required cases: one error then close takes two clicks; three errors throw
  the exact message after three clicks; a prompt that closes on the first click takes one.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [346.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-cVbpAk/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-elbxl5/artifacts/20260101-000000-abcd/privy/planted.json

 42 pass
 0 fail
 140 expect() calls
Ran 42 tests across 9 files. [749.00ms]
exit=0
```

The two `leak:` lines are the expected planted-secret fixture in `report.test.ts`; the paths are
temporary test directories.

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 26 pass
 0 fail
 83 expect() calls
Ran 26 tests across 1 file. [7.77s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:637:16 › the human acceptance run
  [injected] › buy.spec.ts:637:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
(no output)
```
