# cs-11b-search-reasons — offer search ignores stopwords, matches whole words and names each word once (refs #55)

## Setup

Run `bun install` at the worktree root before anything else.

## The defect

`GET /offers/search` in `apps/hub/src/frontdoor.ts` finds offers by substring, so its reasons read like raw matches. In production the query "deploy a contract on arc" gives `summary has "on"` and `takes "on"`:

- "on" is a stopword;
- it "matched" the input property `question`, which contains the letters o-n.

The web assistant shows these reasons word for word, and the same query word appears again for every field it touched.

## Lease

You may create or change only these paths:

- `apps/hub/src/frontdoor.ts`: only `searchOffers`, `scoreOffer`, `tokenise` and new private helpers for them
- `apps/hub/test/frontdoor.test.ts`
- `.packets/reports/cs-11b-search-reasons.md`

## What to change

### 1. Stopwords

`tokenise` lowercases, splits on non-alphanumerics, drops tokens shorter than 2 characters, drops duplicates, and also drops every word in this fixed list, held as a `Set` constant:

```
a an the and or but of on in at to for from by with about into onto over as is are was were be been
it its this that these those i me my we our you your he she they them their can could would should
will shall may might do does did done how what which who whom why when where please want need some
any all get make let just so if then than there here not no yes up out via per using use
```

If no tokens are left, `searchOffers` returns `{query, results: []}`, with the trimmed query. An empty query still returns `{query: "", results: []}`, as today.

### 2. Whole-word matching

Match each token against a field's **words**, never against raw substrings.

- **Title, summary and upstream URL**: split the lowercased text on non-alphanumerics.
- **Input and output property names**: also split camelCase, snake_case and kebab-case. For example, `questionText` gives `question` and `text`.
- **A token matches a word** when they are equal, or when one is a prefix of the other and the shorter one is at least 4 characters long.
  - `contracts` matches `contract`, and `deploying` matches `deploy`.
  - `arc` matches only `arc`, not `architecture`.
  - `ion` never matches `question`.
- **Adapter**: the token must equal the adapter word, such as `skill`.

### 3. Scoring

Scoring is unchanged except that it uses word matches. Each field a token matches adds its points:

| Match | Points |
|---|---|
| title | 3 |
| summary | 1 |
| adapter | 2 |
| upstream | 1 |
| an input property (`takes`) | 2 |
| an output property (`returns`) | 2 |
| the seller is online | +1 |

### 4. Reasons: each query word once

`why` is a list of short phrases.

- **One field per word.** Each matched token appears in exactly one phrase: the phrase for the first field it matched, in this order: title, takes, returns, served by, summary, upstream.
- **One phrase per field.** It lists that field's tokens in query order:
  - `title has "deploy"`
  - `title has "deploy" and "contract"`
  - `title has "deploy", "contract" and "arc"`
  - `takes "question"` and `returns "answer"`, joined the same way
  - `served by a skill`, as today
  - `summary has …` and `upstream has …`
- **Order.** Phrases follow the field order above, then `seller is online` when the seller is online.
- **No duplicates.** No phrase appears twice, and no token appears in two phrases.

## Tests (`apps/hub/test/frontdoor.test.ts`)

**Update** the existing test "why names each matched token once" to the new rules. Keep its assertion that no reason repeats, and add an assertion that no token appears in two reasons.

**Add tests:**

1. **The production defect.** The query "deploy a contract on arc" runs against an offer:
   - titled "Deploy a contract on Arc";
   - with summary "Deploys a contract on Arc and returns its address.";
   - with input property `question` and output property `address`.

   Assert that:
   - `why` contains `title has "deploy", "contract" and "arc"`;
   - no reason contains `"on"` or `"a"`;
   - no reason starts with `summary has`, because every matched word was already credited to the title.
2. **Substring matches are gone.** Query `ion` does not match an offer whose only use of those letters is the input property `question`. Query `architecture` does not match an offer titled "Arc".
3. **Prefixes match.** Query `contracts` matches the title "Deploy a contract", and the reason is `title has "contracts"`.
4. **Property names are split.** Query `question` matches the input property `questionText` with the reason `takes "question"`.
5. **Stopword-only queries.** Query `what is the` returns `{query: "what is the", results: []}`.
6. **Three fields.** A token that matches title, summary and upstream appears only in the title phrase, while the score still counts all three fields (3 + 1 + 1).

Other existing frontdoor tests may assert scores or reasons that change under word matching. Change only those expectations, and list each change, with the reason, in the report.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. TypeScript strict, no `any`.
- Do not change the response shape: `SearchHit` keeps `why: string[]`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test
```

Every command passes, with no new skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #55)`, and no trailers. Write `.packets/reports/cs-11b-search-reasons.md`. Do not push, merge or deploy.
