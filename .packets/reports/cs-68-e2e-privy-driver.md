# cs-68-e2e-privy-driver: drive Privy's real modal, and never hang on a click

Status: complete on `cs/cs-68` at `2d6c212`, on top of `cs/cs-67` (`d0df35d`). No browser was
launched, no acceptance run was started, and no key or Privy login was read or printed. Playwright
was called with `--list` only, and `playwright install` was not run.

## The change

### `e2e/human/lib/privy.ts`

- **27-30:** `dialog(page)` returns `page.getByRole("dialog")` with no visible filter. It is used
  only to scope the inputs inside Privy's zero-size dialog wrapper.
- **32-46:** `modalContent(page)` is the union of `#privy-modal-content` and the
  `Log in or sign up` heading, reduced with `.first()`. `dialogVisible` waits for that union to be
  visible and returns `true`, or `false` on timeout.
- **51-71:** `PrivyAttempt` gains an optional `menuUsable()` check. `openPrivy` now skips the menu
  retry when that check is false, so it never clicks `wallet-menu` under a visible backdrop. When
  the callback is absent the previous retry behaviour is unchanged.
- **96-129:** `signIn` waits 30 s for the same modal content as `dialogVisible` and throws
  `Privy's modal did not open` on timeout. It takes the first visible email field from the
  placeholder, the email input, or a textbox, all scoped to the dialog; fills it and presses Enter.
  It no longer looks for or clicks a submit button, so `Continue with a wallet` cannot be chosen.
  The one-time-code field is now dialog-scoped, then focused and typed as before. Completion still
  waits 120 s for `wallet-address[data-value]`.
- **131-136:** `approveIfPrompted` keeps `page.getByRole("dialog")` (now unfiltered by `dialog()`)
  and the `/^(sign|approve|confirm)/i` button regex; no change was needed.

### `e2e/human/tests/buy.spec.ts`

- **313-324:** `openPrivy` gets `menuUsable`, which waits 2 s for `#privy-dialog-backdrop` to be
  hidden. A backdrop still visible means the modal is open, so `openPrivy` skips the menu retry
  instead of clicking through the backdrop.

### `e2e/human/playwright.config.ts`

- **15-23:** `use` now sets `actionTimeout: 30_000` and `navigationTimeout: 60_000`, so a stuck
  click fails on its own instead of waiting out the 10-minute test timeout.

### `e2e/human/test/privy.test.ts`

- **76-100:** proves `openPrivy` does not call `clickMenu` when `dialogVisible` is false but the
  menu is covered (`menuUsable` false), and records no second-click note.
- **102-238:** a browser-free fake page models the email placeholder, a decoy textbox, the code
  field and the wallet button. The test proves the placeholder field is the one filled, Enter is
  pressed in it, the code is typed, and no button query or click names a wallet button. Playwright's
  own `toHaveAttribute` runs against a fake `_expect`.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [123.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-1Md4a9/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-QHOcJQ/artifacts/20260101-000000-abcd/privy/planted.json

 39 pass
 0 fail
 122 expect() calls
Ran 39 tests across 9 files. [485.00ms]
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
Ran 26 tests across 1 file. [7.71s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:625:16 › the human acceptance run
  [injected] › buy.spec.ts:625:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
(no output)
```
