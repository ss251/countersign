# cs-63-e2e-human-price: the buyer paid exactly the listed price; --list writes no report

Lane: cs-e2e. Branch: `cs/cs-60`, continuing from its head (`d93b9ac` or later). Two small changes in
`e2e/human/`, each its own commit.

## 1. The price paid is the price listed (`tests/buy.spec.ts`, the on-chain proof step)

cs-w1's B24 showed that a page can sign the 402's terms instead of the listing's, so a hostile hub could
take any amount. The acceptance run proves the opposite end to end.

After the slip is read (`body.offerHash`, `body.amount`):

- `GET <hub>/offers/<body.offerHash>` must answer 200. Take the listed offer's `price` and its escrow payee,
  computed exactly as the rail does (`packages/rail/src/escrow/index.ts:217`):
  `offer.payTo?.escrow ?? offer.seller`. Live escrow offers have `payTo: null` or a payTo without an
  `escrow` key, so the seller is the usual answer. Save the body as `artifacts/<run>/<project>/offer.json`.
- `body.amount` equals the listed `price` exactly.
- The `Funded` log's `amount` equals the listed `price`, and its `payee` equals the listed payee,
  case-insensitive.
- On failure: `the buyer paid <amount> to <payee>, but the offer lists <price> to <listed payee>`.

## 2. `--list` writes no report (`lib/report.ts`)

Today the reporter writes `runs/<id>.md` and `LATEST.md` even when no test began, for example under
`playwright test --list`. Track whether `onTestBegin` was called at least once. In `onEnd`, if no test
began, write nothing and return. The leak scan still runs whenever a report is written.

Add an offline test: a reporter that receives `onBegin` and `onEnd` with no `onTestBegin` writes no file.

## Gate (paste the tails in your report)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests, and then
   `git status --short e2e/human/runs` shows nothing new.

## Constraints

- **No browser of any kind on this machine:** only `--list`; never a test run; no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never commit `bun.lock`. Never read or print a real key or the Privy login.
  Never move funds and never call production.
- Never push, merge or deploy. Small present-tense commits on `cs/cs-60`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-63-e2e-human-price.md`: each change with its line range, and the gate outputs.
