# cs-77-e2e-c2-envelope: STEER-0215 C2's acceptance, run in the privy project

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-77`. URGENT: this is the acceptance for the project lead's QA
item C2.

## What C2 requires (STEER-0215)

The acceptance is e2e/human on production: a fresh Privy test user opens Buyer and clicks Create an
envelope, and the page shows the envelope and the approval list without leaving the page.

- **The hub route** is `POST /envelopes/session` (live on main 872c8cb). It creates or returns the
  envelope for the user's embedded wallet, with these defaults (`apps/hub/src/buyerplumbing.ts`):
  - `cap` "1000000";
  - `perMerchant` "500000";
  - `askAbove` "50000";
  - `expiresAt` now + 86400;
  - `revoked` false;
  - `allowlist` empty;
  - `approver` the agent.

  It returns a token `cse_<64 hex>` once.
- **Reading the envelope.** `GET /envelopes/:agent` with `Authorization: Bearer <token>` returns
  `{ envelope, spent, ... }`. A token scoped to one agent gets 401 on any other agent.
- **The console** (cs-ui PR #275, `apps/web/src/routes/buyer/**`):
  - The Buyer page (`#/buyer`) opens on the approvals tab. Without a token it shows
    `[data-testid="buyer-locked"]`, with a button named "Create an envelope" inside it.
  - Signed in, that button calls the route. It stores the token in localStorage under
    `countersign.approval-token` and the agent under `countersign.agent`, and it never shows the token.
    Then the page re-reads in place.
  - The approvals tab then shows the approval list: "Nothing is waiting for you." when it is empty, or an
    approval card.
  - The tab bar is `nav[aria-label="Buyer"]`, with a link named "Envelope". The envelope tab shows a
    section with `aria-label="Budget"`.

## Change `e2e/human/tests/buy.spec.ts`: three steps after step 08, privy project only

Add them as hard steps with `step(...)`, so they fail the run. For the injected project, do not add
them.

1. **`09 buyer` "Buyer offers to create an envelope".**
   - `page.goto("/#/buyer")`.
   - `[data-testid="buyer-locked"]` is visible within 30 s.
   - The button `getByRole("button", { name: /create an envelope/i })` inside it is visible and enabled
     within 30 s.
2. **`10 envelope` "Create an envelope, shown in place".** Remember `page.url()`, then click the button.
   - `buyer-locked` becomes hidden within 30 s. No `[role="alert"]` is visible on the page.
   - The approvals list shows: the text "Nothing is waiting for you." or an
     `article[aria-labelledby="approval-title"]` is visible within 30 s.
   - The page did not leave: `new URL(page.url()).hash` still starts with `#/buyer`.
   - Read the token only this way:
     `const token = await page.evaluate(() => window.localStorage.getItem("countersign.approval-token"))`.
     - It must match `/^cse_[0-9a-f]{64}$/`. On a mismatch, fail with
       "the console stored no session token". Never include the value.
     - **Immediately**, before anything else uses it, call `keys.hide(token)`. That registers it as a
       secret for the leak scan and for the screenshot guard.
     - Never put the token in a note, an error message, a file, an artifact name or a log line.
   - Read `countersign.agent` the same way. It must equal the embedded wallet address from step 02,
     compared case-insensitively.
   - `GET {hub}/envelopes/{wallet}` with `Authorization: Bearer ${token}` answers 200. Put its JSON
     `envelope` through a new pure helper, `sessionEnvelopeProblems(envelope, wallet, nowSeconds)` in
     `e2e/human/lib/envelope.ts`. It returns a list of problem strings and is empty when:
     - `cap === "1000000"`;
     - `askAbove === "50000"`;
     - `perMerchant === "500000"`;
     - `revoked === false`;
     - `allowlist` is an empty array;
     - `agent` and `approver` equal the wallet (case-insensitive);
     - `nowSeconds < expiresAt <= nowSeconds + 86400 + 300`.

     The route returns an existing envelope unchanged, so on a repeat run the expiry is earlier than a
     fresh 24 h. Fail with the problems joined by "; ". They name fields and expected values only.
   - **The scope check.** `GET {hub}/envelopes/0x000000000000000000000000000000000000dEaD` with the same
     header answers 401: "a session token reads only its own agent's envelope".
   - Error messages for both GETs give the status code and the hub's `code` field only, never a header.
3. **`11 envelope-tab` "The envelope tab shows the envelope".**
   - Click `page.getByRole("navigation", { name: "Buyer" }).getByRole("link", { name: /envelope/i })`.
   - `page.getByRole("region", { name: "Budget" })` is visible within 30 s, and the hash still starts
     with `#/buyer`.
   - Add a note: `envelope: cap 1 USDC, per seller 0.5, ask above 0.05, expires in <h> h`, with the
     hours from `expiresAt`. No token.

## Tests (`bun test e2e/human/test`), a new `envelope.test.ts`

`sessionEnvelopeProblems`:

- A correct envelope gives `[]`.
- Each of these gives one problem that names the field: a wrong `cap`, a wrong `askAbove`, a non-empty
  `allowlist`, `revoked` true, an `approver` that is not the wallet, an `expiresAt` in the past, and an
  `expiresAt` more than 24 h plus 5 min ahead.

Use made-up addresses. No token appears in any test.

## Gate (all four; paste the tails)

1. `bun install --linker hoisted && bun run typecheck` clean.
2. `bun test e2e/human/test` and `bun test e2e/test` all pass.
3. Under Node: `cd e2e && npx playwright test -c human/playwright.config.ts --list` lists the two tests.
4. `git status --short e2e/human/runs` shows nothing new.

## Constraints

- No browser of any kind on this machine: `--list` only, never a test run, no `playwright install`.
- **Never run `git stash`;** use a temporary commit or a second worktree.
- Touch only `e2e/human/**`. Never read or print a key, the Privy login or any token.
- Never push, merge or deploy. Make small present-tense commits on `cs/cs-77`, with no emoji, no
  Co-authored-by and no trailers.
- If something cannot be done as written, stop and say exactly what and why.

## Report

`.packets/reports/cs-77-e2e-c2-envelope.md`: the changes with line ranges, and the gate outputs.
