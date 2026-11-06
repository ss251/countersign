# cs-75-e2e-injected-connect: the injected test wallet behaves like a person's wallet, and picks itself in Privy's list

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-75`. URGENT: the 21:30Z nightly runs this project.

## Evidence

1. **The first-ever run of the injected project failed.** GitHub Actions run 42283375491 (human run
   20261106-195238-0ba9, cs/e2e b317f2b) failed at step 01 with
   `locator.click: Timeout 30000ms exceeded` while waiting for `[data-testid="wallet-menu"]`.
   - The trace's DOM snapshot shows why: before any click, the header already showed `wallet-address`
     with `data-kind="injected"` and the test account's address. The console had connected the wallet on
     load, so `wallet-menu` was gone.
   - The cause is in the test double. `handleWalletRequest` answers `eth_accounts` with the account
     straight away. A real browser wallet answers `[]` until the site asks for access with
     `eth_requestAccounts`. Privy reads `eth_accounts` on load and treats a wallet that answers it as
     already connected.
2. **A keyless diagnostic on production shows the right path.** It used a fake wallet whose
   `eth_accounts` is `[]` until `eth_requestAccounts`. The page did not auto-connect, and `wallet-menu`
   was present. `wallet-connect-injected` ("Connect a browser wallet") then opened Privy's modal:
   heading "Select your wallet", and a `button "Countersign test wallet"` among the wallets it lists.
   Clicking that button made Privy call `eth_requestAccounts`. The modal closed, and `wallet-address`
   showed the address with `data-kind="injected"`.

## Changes

### `e2e/human/lib/wallet.ts`

1. Export `interface WalletSession { authorized: boolean }` and
   `export function newWalletSession(): WalletSession` that returns `{ authorized: false }`.
2. Give `handleWalletRequest` a last parameter, `session: WalletSession = newWalletSession()`, after
   `rpcUrl`.
   - `eth_requestAccounts` sets `session.authorized = true` and returns `[account.address]`.
   - `eth_accounts` returns `[account.address]` only when `session.authorized` is true, and `[]`
     otherwise.
   - Every other method behaves exactly as now.
3. `installTestWallet` creates one session with `newWalletSession()` and passes it to every call from
   that context's binding.

### `e2e/human/tests/buy.spec.ts`, the injected sign-in only

After `await testId(page, "wallet-connect-injected").click();`, and before the existing wait for
`wallet-address`:

- If `dialogVisible(page, 15_000)` is true (Privy's wallet list opened), click
  `page.getByRole("dialog").getByRole("button", { name: /countersign test wallet/i })`.
  - If that button is not visible within 15 s, fail with
    `Privy's wallet list did not offer the Countersign test wallet`.
- If no dialog opened, which is the console without Privy, go straight on.

Then comes the existing `waitAttr(page, "wallet-address", ...)`. The privy path and every assertion stay
unchanged.

## Tests (`bun test e2e/human/test`)

Replace the test "returns the account for both account methods" in `wallet.test.ts` with these. The old
test asserted the unrealistic behaviour this packet removes.

1. **A fresh session is not authorized.** `eth_accounts` returns `[]`.
2. **The same session after `eth_requestAccounts`.** `eth_requestAccounts` returns `[account.address]`,
   then `eth_accounts` returns `[account.address]`.
3. **Two sessions are independent.** Authorizing one leaves the other's `eth_accounts` empty.

The other wallet tests do not change.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/lib/wallet.ts`, `e2e/human/tests/buy.spec.ts` and `e2e/human/test/wallet.test.ts`.
  Never read or print a key or the Privy login.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-75`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-75-e2e-injected-connect.md`: the changes with line ranges, and the gate outputs.
