# cs-75-e2e-injected-connect: the injected wallet waits to be asked, then picks itself in Privy's list

Status: complete on `cs/cs-75`. No browser was launched and no acceptance run was started
(`--list` only), `playwright install` was not run, no key or Privy login was read or printed, and
`git stash` was not used. Nothing was pushed, merged or deployed.

## The changes

### `e2e/human/lib/wallet.ts`

- **21-27:** new exported `interface WalletSession { authorized: boolean }` and
  `newWalletSession(): WalletSession`, which returns `{ authorized: false }`.
- **110-116:** `handleWalletRequest` gains a last parameter,
  `session: WalletSession = newWalletSession()`, after `rpcUrl`.
- **118-123:** `eth_requestAccounts` sets `session.authorized = true` and returns
  `[account.address]`. `eth_accounts` returns `[account.address]` only when the session is
  authorized, and `[]` before that. Every other method keeps its existing behaviour.
- **180-182:** `installTestWallet` creates one session with `newWalletSession()` per browser
  context and passes it to every call from that context's `__csWallet` binding. A page that loads
  and asks `eth_accounts` no longer looks connected; only `eth_requestAccounts` authorizes it.

### `e2e/human/tests/buy.spec.ts`

- **308-323:** the injected sign-in branch. After clicking `wallet-connect-injected` it calls
  `dialogVisible(page, 15_000)`. When Privy's wallet list opened, it waits up to 15 s for
  `page.getByRole("dialog").getByRole("button", { name: /countersign test wallet/i })`, throws
  `Privy's wallet list did not offer the Countersign test wallet` when the button never appears,
  and otherwise clicks it so Privy calls `eth_requestAccounts`. When no dialog opened (the console
  without Privy), it goes straight on. The existing `waitAttr(page, "wallet-address", ...)` follows
  unchanged. The privy path and every assertion are untouched.

### `e2e/human/test/wallet.test.ts`

- **5:** imports `newWalletSession`.
- **16-18:** replaces the removed "returns the account for both account methods" test with a fresh
  session whose `eth_accounts` is `[]`.
- **20-28:** the same session after `eth_requestAccounts`: that call returns `[account.address]`,
  then `eth_accounts` returns `[account.address]`.
- **30-35:** two sessions are independent: authorizing one leaves the other's `eth_accounts`
  empty.

The other wallet tests do not change.

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

+ @countersign/relay@workspace:packages/relay

3 packages installed [326.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

e2e/human/test/report.test.ts:
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-ilHBb4/artifacts/20260101-000000-abcd/privy/planted.json
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-cCSY2O/test-results/buy-retry/error-context.md
leak: /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T/cs-human-report-PEDV3Q/artifacts/20260101-000000-abcd/privy/planted.json

 54 pass
 0 fail
 166 expect() calls
Ran 54 tests across 9 files. [1.92s]
exit=0
```

The three `leak:` lines are the expected planted-secret fixtures, all under temporary test
directories.

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 31 pass
 0 fail
 88 expect() calls
Ran 31 tests across 1 file. [7.76s]
exit=0
```

```
$ cd e2e && npx playwright test -c human/playwright.config.ts --list
Listing tests:
  [privy] › buy.spec.ts:652:16 › the human acceptance run
  [injected] › buy.spec.ts:652:16 › the human acceptance run
Total: 2 tests in 1 file
exit=0
```

```
$ git status --short e2e/human/runs
exit=0
```
