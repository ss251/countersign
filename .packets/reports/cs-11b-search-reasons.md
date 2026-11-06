# cs-11b-search-reasons report

## What changed

- `apps/hub/src/frontdoor.ts`
  - `tokenise` now drops a fixed `STOPWORDS` set (held as a `Set` constant) after the existing lowercase/split/length/dedupe rules.
  - `searchOffers` returns the trimmed query when no tokens remain, so an empty query still returns `{query: "", results: []}` and a stopword-only query returns `{query: "what is the", results: []}`.
  - `scoreOffer` now matches tokens against words, not raw substrings:
    - title, summary and upstream URL are split on non-alphanumerics;
    - input/output property names are additionally split on camelCase, snake_case and kebab-case;
    - a token matches a word by equality, or by prefix when the shorter string is at least four characters;
    - the adapter only matches when the token equals the adapter word.
  - Scoring keeps the same point values and sums every field each token matches.
  - Reasons are built field by field in the order title, takes, returns, served by, summary, upstream, then `seller is online`. Each token is credited to the first field it matched, so every token appears in at most one phrase, and each field's tokens are listed in query order with `"a"`, `"a" and "b"`, `"a", "b" and "c"` formatting.
- `apps/hub/test/frontdoor.test.ts`
  - Updated the existing `why names each matched token once` test.
  - Added six tests covering the production defect, substring removal, prefix matching, camelCase property splitting, stopword-only queries, and a token matching title + summary + upstream scoring all three while appearing only in the title phrase.

## Existing expectations changed

All changes are in `why names each matched token once` (query `arc question skill answer`):

- `title has "question"` → `title has "arc" and "question"`: `arc` and `question` both match the title, so the single title phrase lists both tokens in query order.
- Removed `summary has "question"`: `question` was already credited to the title, and each token appears in only one phrase.
- Removed `upstream has "arc"`: `arc` was already credited to the title.
- Removed `takes "question"`: `question` was already credited to the title.
- Kept `returns "answer"` and `served by a skill`.
- Added `expect(hit.why).not.toContain('summary has "question"')` and a quoted-token uniqueness assertion alongside the existing no-duplicate-phrase assertion.

No other existing frontdoor expectations changed: the score assertions in the ranking test remain 3 and 1 under word matching.

## Design decisions

- `wordsOf` handles title/summary/upstream; `propertyWords` adds camelCase boundary splits then reuses the same non-alphanumeric split, so `questionText` becomes `question` and `text`.
- `matchesWord` compares lengths only to choose the shorter side of the prefix test; `arc` (3 chars) therefore cannot match `architecture`, and `ion` cannot match `question`.
- The adapter continues to use the existing `article` helper, so the reason stays `served by a skill` even when several tokens hit the adapter; a boolean records whether any adapter token was credited there.
- Reason construction no longer needs a dedupe set: the first-match assignment guarantees both unique phrases and unique tokens.

## Acceptance output

```
$ bun install
bun install v1.3.14 (0d9b296a)
Checked 162 installs across 182 packages (no changes) [7.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/hub
 64 pass
 0 fail
 376 expect() calls
Ran 64 tests across 6 files. [2.11s]

$ bun test
 507 pass
 3 skip
 0 fail
 1759 expect() calls
Ran 510 tests across 62 files. [15.25s]

$ forge test
Ran 3 test suites in 160.38ms (120.86ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

The 3 skips are the pre-existing `apps/web/test/onchain.live.test.ts` live-onchain gate (`CS_LIVE`). No test was added as skipped.

## Not done

Nothing in the packet was left undone. No pushes, merges or deploys, and no browser was launched.
