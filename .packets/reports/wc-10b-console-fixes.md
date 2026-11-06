# wc-10b — three corrections to the console checkout

Issue: #14. Corrective for wc-10 (`cbef082`), from cs-wc's review.

## What changed

### Fix 1: the console's deploy installs hoisted

`apps/web/deploy.sh`: the archive install is now
`bun install --frozen-lockfile --linker hoisted`. That gives `apps/web/server.ts` its `hono` import
and `examples/whitechain/checkout-merchant.ts` its `@countersign/relay` import, because both resolve
from the hoisted root. Nothing else in the script changed. `deploy/railway/web.Dockerfile` was not
touched.

### Fix 2: `/status` reads the FeeSplit's USDT balance from the token

`packages/relay/src/server.ts`: `feeSplitUsdt` now calls `balanceOf` at `USDT.address` with
`args: [feeSplit]`, instead of calling it at the FeeSplit itself. The rest of `/status`, including
the 30-second cache and the `null` fallback, is unchanged.

### Fix 3: the merchant service keeps the relay's HTTP status

`packages/relay/src/refund-client.ts`:

- `refundOrderWithStatus(input)` is exported and returns `{ reply, status }`. Its body is the old
  `refundOrder` body with the same branches in the same order.
- Local refusals answer `not_your_order` 403, `partial_cancel_not_possible` 400,
  `refund_not_possible` 400, and `not_refundable` 409.
- A parsed reply from the relay carries the relay response's own status.
- A thrown fetch, a 5xx, or a non-JSON body is `ok: "unknown"` with 502.
- `refundOrder(input)` is `(await refundOrderWithStatus(input)).reply`; its type, behaviour, and the
  `./browser` export are unchanged.

`packages/relay/src/merchant-server.ts`: the refund route keeps its token check, body validation,
and order lookup, then calls `refundOrderWithStatus` and answers `c.json(reply, status)`. The
route's own status mapping is gone. `browser.ts` is unchanged.

## What the new tests prove

`packages/relay/test/funding-token.test.ts`:

- The fake reader answers `balanceOf` only when the call's address is `USDT.address` and its first
  argument is the FeeSplit, and throws for any other token address. `/status` returns that balance
  as `funding.feeSplitUsdt`. The old implementation would hit the throwing branch, swallow the
  error, and return `null`, so this test pins the token read.

`packages/relay/test/refund-status.test.ts`, the function:

- `refundOrderWithStatus` answers 403, 400, 400 and 409 for the four local refusals, with the same
  reply bodies the wrapper returns.
- A thrown fetch answers 502 with an unknown reply.
- A relay reply carries the relay's own status (422 with `job_not_open` in the test).

`packages/relay/test/refund-status.test.ts`, the merchant service with a fake relay:

- `/orders/:id/refund` for a held escrow order forwards the relay's 422 and the exact body
  `{ ok: false, reason: "job_not_open" }`; before this fix the route turned it into 200.
- `/orders/:id/refund` for a paid order forwards the relay's 200 and its `ok: true` body.

Every existing test, including wc-10's, passes unedited; no existing assertion was changed.

## Acceptance

All commands were run on `cs/wc-10b` after `bun install --linker hoisted`:

- `bun run typecheck`: clean.
- `bun test`: 1226 pass, 4 skip, 0 fail (147 files).
- `forge test`: 47 passed, 0 failed.
- `bun run --cwd apps/web build`: built `dist/` successfully.
- `DRY_RUN=1 bash apps/web/deploy.sh HEAD`: succeeded; last five lines:

```

  server.js  0.54 MB  (entry point)

staged 2.2M
DRY_RUN=1: not uploading. Stage left at /var/folders/p4/8cqx396x7yl142gkb4sqv5800000gn/T//countersign-console.0OHg1r
```

`bun.lock` was not modified or committed.
