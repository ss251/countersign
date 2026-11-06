# cs-77-e2e-c2-envelope report

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-77`.

## Changes

### `e2e/human/lib/envelope.ts`

New file, lines 1-62:

- lines 7-16: the route's fixed defaults (`cap` `1000000`, `perMerchant` `500000`,
  `askAbove` `50000`), the 24-hour session TTL and the five-minute skew.
- lines 18-22: `SessionEnvelope`, the shape the helper reads, and a case-insensitive address
  comparison.
- lines 24-62: `sessionEnvelopeProblems(envelope, wallet, nowSeconds)`. It returns one problem per
  field that differs from the session defaults, naming the field and the expected value only:
  `cap`, `askAbove`, `perMerchant`, `revoked`, `allowlist`, `agent`, `approver`, and `expiresAt`
  in `(nowSeconds, nowSeconds + 86400 + 300]`. It returns `[]` for a correct envelope.

### `e2e/human/test/envelope.test.ts`

New file, lines 1-95. Twelve offline tests:

- a correct envelope gives `[]`;
- the wallet compares case-insensitively;
- a wrong `cap`, `askAbove` or `perMerchant`, a non-empty `allowlist`, `revoked` true, a foreign
  `agent` or `approver`, an `expiresAt` in the past, and an `expiresAt` more than 24 h plus 5 min
  ahead each give exactly one problem that names the field;
- an `expiresAt` exactly 24 h plus 5 min ahead is still accepted.

The addresses are made up (`0xabc…0001`, `0xdef…0002`). No token appears in the file.

### `e2e/human/tests/buy.spec.ts`

- line 22: imports `sessionEnvelopeProblems` and `SessionEnvelope`.
- lines 125-135: `hubFailure(response)` returns only the status code and the hub body's `code`
  field, never a request header.
- lines 633-714: the three privy-only hard steps after step 08:
  - `09 buyer` "Buyer offers to create an envelope" (lines 634-641): opens `/#/buyer`, waits for
    `[data-testid="buyer-locked"]`, then for the enabled "Create an envelope" button inside it.
  - `10 envelope` "Create an envelope, shown in place" (lines 643-700): remembers the URL, clicks
    the button, waits for `buyer-locked` to hide, checks that no `[role="alert"]` is visible, and
    accepts either "Nothing is waiting for you." or an `article[aria-labelledby="approval-title"]`.
    It keeps the hash on `#/buyer`, reads `countersign.approval-token` only through
    `page.evaluate`, fails with "the console stored no session token" on a mismatch, and registers
    the token with `keys.hide(token)` immediately. It reads `countersign.agent` the same way and
    compares it to the step 02 wallet case-insensitively. It then reads
    `GET {hub}/envelopes/{wallet}` with the bearer token, puts the JSON `envelope` through
    `sessionEnvelopeProblems`, and checks that the same token gets 401 from
    `GET {hub}/envelopes/0x…dEaD` with "a session token reads only its own agent's envelope".
  - `11 envelope-tab` "The envelope tab shows the envelope" (lines 702-713): clicks the Buyer
    navigation's Envelope link, waits for the `region` named "Budget", keeps the hash on `#/buyer`,
    and notes `envelope: cap 1 USDC, per seller 0.5, ask above 0.05, expires in <h> h` from
    `expiresAt`.

The injected project does not enter this block, so it gains no steps 09-11.

## Gate

### 1. Install and typecheck

```text
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 1031 installs across 774 packages (no changes) [581.00ms]
$ tsc -p tsconfig.json
```

Exit code 0; no diagnostics.

### 2. Offline tests

```text
$ bun test e2e/human/test
 66 pass
 0 fail
 187 expect() calls
Ran 66 tests across 10 files. [3.95s]
```

```text
$ bun test e2e/test
 40 pass
 0 fail
 114 expect() calls
Ran 40 tests across 2 files. [10.50s]
```

The `leak:` lines printed by the report tests are the leak scan's expected output for its planted
fixtures; the suite still reports 0 fail.

### 3. Playwright list

```text
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:748:16 › the human acceptance run
  [injected] › buy.spec.ts:748:16 › the human acceptance run
Total: 2 tests in 1 file
```

### 4. Runs directory

```text
$ git status --short e2e/human/runs
(no output)
```

## Notes

- No browser was used and no Playwright test was run; only `--list`. No `playwright install`.
- No key, Privy login or token was read or printed. The session token is read only in the browser
  page, validated, and registered with `keys.hide`; it is never noted, written, named in an
  artifact, or included in an error.
- The pre-existing file-mode change on `packages/cli/src/bin.ts` was left unstaged and untouched.
