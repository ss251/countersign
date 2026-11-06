> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 2383e90 (PR 178, cs/phone-03): the openapi adapter

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. The slip and Release paths are untouched, and the funding check runs before the child, as for skills.

## Held
- **Host.** It comes only from the seller: `--base-url` or the document's first server, http(s) only. Buyer input cannot reach it.
- **Path.** Each path value is `encodeURIComponent`-ed into one segment (`/`, `?` and `#` stay encoded), and `.`/`..` become `%2E`, so nothing climbs the path. Path parameters are required in the offer's input schema, so the hub refuses a missing one before payment.
- **Query.** Only the operation's declared query parameters are appended, through `URLSearchParams`.
- **The call.** `redirect: "error"`, so it never follows to another host. Only `accept` and `content-type` are sent: no environment, cookies or auth. It runs inside the scrubbed child.
- **The answer.**
  - Non-2xx is refused without its body.
  - Non-JSON is refused.
  - A float is refused before hashing.
  - The output `{operationId, status, inputHash, result}` is committed by the slip's `outputHash`.

## Note
- **The response is read whole into memory** (`response.text()`) before the runner's 1 MB output ceiling applies. A buyer can ask the seller's API for a large resource. Read at most about 1 MB and refuse beyond it, and give the fetch its own timeout under the child's 30 s so a slow API fails with a clear sentence.
