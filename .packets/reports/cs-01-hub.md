# cs-01-hub report

## What was built

`apps/hub` is a Bun + Hono server with:

- `src/store.ts`: `Store` on `bun:sqlite` with the `offers`, `jobs` and `slips` tables, typed accessors, and `fundedJobsPastDeadline(now)`. The deadline sweep includes `failed` jobs as well as `funded` ones, because a failed delivery leaves the money locked until the buyer's deadline (test 7 requires the refund).
- `src/runners.ts`: `RunnerLink` with challenge/hello/ready, seller signature recovery, offer filtering by seller, online lookup, job dispatch with timeout, result/fail routing, 20 s pings, 45 s pong enforcement, and close cleanup.
- `src/call.ts`: the paid-call pipeline in packet order (offer, input gate, offline check, accepts, 402, decode, price/payee/asset checks, verify, settle, job, order, dispatch, output/slip checks, release, slip storage, 200 response).
- `src/delivery.ts`: internal helpers for building the `JobOrder` and checking the delivered slip (hashes, field-by-field body equality, output schema, seller signature).
- `src/janitor.ts`: `runJanitor` refunds locked jobs after their deadline and records `refunded` plus `close_tx`.
- `src/app.ts`: `createHub` with all routes, CORS for the three `PAYMENT-*` headers, and the Hono Bun WebSocket adapter.
- `src/rails.ts`: `railsFromEnv` returns `[]` with the `// rails are wired by orch-cs` comment.
- `src/index.ts`: boot with `PORT`, `HUB_DB`, `HUB_PUBLIC_URL`, directory creation, `Bun.serve`, the 30 s janitor interval, and one startup log line.
- `src/types.ts`: `Listing`.

Tests in `apps/hub/test` include a fake escrow/direct rail, a real-WebSocket runner client that signs hello and slips, and coverage for publish, 402/header equivalence, accepts order, bad input, offline seller, the paid happy path, moved price, failed output plus janitor refund, bad hello signature, and a runner claiming another seller's offer.

## Helpers added

- `apps/hub/src/deps.ts`: a relative re-export bridge for `packages/core/src/index.ts` and `packages/rail/src/index.ts`. `apps/hub/package.json` does not declare `@countersign/core` or `@countersign/rail`, and this packet forbids editing `package.json`, so the bridge keeps the same implementations without changing the manifest. No other package files were touched.
- `apps/hub/src/delivery.ts`: order construction and slip/output verification, split out to keep `call.ts` under the file-size guide.
- `apps/hub/src/util.ts`: `isRecord`, hex/nonce guards, `sameText`, and `randomNonce`.

The janitor intentionally selects `status IN ('funded', 'failed')`: a failed delivery has not been released, so the buyer's money must return at the deadline.

## Acceptance output

```
$ bun install
bun install v1.3.14 (0d9b296a)

Checked 59 installs across 82 packages (no changes) [6.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/hub
 12 pass
 0 fail
 76 expect() calls
Ran 12 tests across 3 files. [216.00ms]

$ bun test
 56 pass
 0 fail
 191 expect() calls
Ran 56 tests across 9 files. [242.00ms]

$ forge test
Ran 3 test suites in 180.60ms (125.86ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

## Not done

Nothing in the packet was left undone. `railsFromEnv` returns an empty list by design until `orch-cs` wires the rails. No pushes, merges or deploys.
