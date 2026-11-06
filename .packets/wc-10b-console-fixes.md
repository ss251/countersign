# wc-10b: three corrections to wc-10's console checkout

Issue: #14. This is the corrective for wc-10 (`cbef082`), found by cs-wc in review.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/wc-10` (`cbef082`), which already carries wc-10.

## Fix 1: the console's deploy installs hoisted

- **What happens now:**
  - `bun.lock` carries `configVersion: 1`, so a fresh `bun install --frozen-lockfile` uses bun's isolated linker. Each workspace then sees only the dependencies it declares.
  - `apps/web/server.ts` now imports `hono`, which `apps/web` does not declare. `examples/whitechain/checkout-merchant.ts` imports `@countersign/relay`, which the isolated layout links only into workspaces that declare it.
  - So `apps/web/deploy.sh`, which installs a `git archive` snapshot, cannot bundle `server.ts`: `Could not resolve: "hono"`.
  - cs-wc reproduced this on the build machine from `cbef082`. The same tree installed with `--linker hoisted` builds, and the console answers `/healthz` 200 and `/checkout/sticker-pack` 402.
- **Decision:** in `apps/web/deploy.sh`, the archive install becomes `bun install --frozen-lockfile --linker hoisted`. That is the layout every gate runs.
- **Nothing else in `deploy.sh` changes.**
- **Not in this packet:** orch-cs changes `deploy/railway/web.Dockerfile`, the same way, in its own edit. Do not touch that file.

## Fix 2: `/status` reads the FeeSplit's USDT balance from the token

- **What happens now:**
  - In `packages/relay/src/server.ts`, `feeSplitUsdt` calls `balanceOf` at the FeeSplit's own address. `contracts/src/FeeSplit.sol` has no `balanceOf`, so the read reverts, the catch returns `null`, and production would always show `feeSplitUsdt: null`.
  - `funding.test.ts`'s fake reader answers `balanceOf` at any address, so the test passes anyway.
- **Decision:** the read goes to `USDT.address` (from `./chain.ts`), with `args: [feeSplit]`.
- **Nothing else in `/status` changes.**

## Fix 3: the merchant service keeps the relay's HTTP status

- **What happens now:**
  - Before wc-10, `POST /orders/:id/refund` in `merchant-server.ts` sent the relay's reply on with the relay's own status (`forward()`).
  - Now the route maps every reply it does not recognise to 200. So a relay refusal, such as a 422 `job_not_open` or a guard's 4xx, reaches the client as 200 with `ok: false`.
- **Decision, in `packages/relay/src/refund-client.ts`:**
  - Add and export `refundOrderWithStatus(input: RefundOrderInput): Promise<{ reply: RefundOrderReply; status: number }>`. It holds the body that `refundOrder` has today, with the same branches in the same order.
  - **Each local refusal carries the status the merchant route uses today:**

    | Reason | Status |
    |---|---|
    | `not_your_order` | 403 |
    | `partial_cancel_not_possible` | 400 |
    | `refund_not_possible` | 400 |
    | `not_refundable` | 409 |

  - **A reply from the relay** carries the relay response's own HTTP status.
  - **`ok: "unknown"`** (a thrown fetch, a 5xx or a non-JSON body) carries 502.
  - `refundOrder(input)` becomes `(await refundOrderWithStatus(input)).reply`. Its behaviour, its type and the `./browser` export do not change.
- **Decision, in `packages/relay/src/merchant-server.ts`:** the refund route keeps its token check and its order lookup. It then calls `refundOrderWithStatus` and returns `c.json(reply, status)`. Delete the route's own status mapping.
- **`browser.ts` does not change.**

## Tests (no network)

1. **Fix 2.** A fake reader answers `balanceOf` only when the call's address is `USDT.address` and `args[0]` is the FeeSplit, and throws for any other `balanceOf`. `/status` then shows that balance in `funding.feeSplitUsdt`.
2. **Fix 3, through the merchant service, with a fake relay:**
   - the relay answers `/escrow/cancel` with 422 `{ ok: false, reason: "job_not_open" }`, so the merchant service answers 422 with that body;
   - the relay answers `/refund` with 200 `{ ok: true, ... }`, so the merchant service answers 200.
3. **Fix 3, the function itself.** `refundOrderWithStatus` returns:
   - 403, 400, 400 and 409 for the four local refusals;
   - 502 for a thrown fetch;
   - the relay's status for a relay reply.
4. **Existing tests.** Every existing test, wc-10's included, passes **unedited**. Add new test files, or new `test(...)` blocks at the end of an existing file. Never change an existing assertion.

## Lease

- `apps/web/deploy.sh`: the install line only.
- `packages/relay/src/server.ts`: the `balanceOf` read only.
- `packages/relay/src/refund-client.ts`.
- `packages/relay/src/merchant-server.ts`: the refund route's tail only.
- `packages/relay/test/*`: new tests only.

Touch nothing else. No view code. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree. All worktrees of a clone share one stash stack.
- **No network** in tests.
- **Never run `deploy.sh` without `DRY_RUN=1`.** Never run `railway` and never set or print any secret.
- **Commits:** small, present tense, ending `refs #14`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test && bun run --cwd apps/web build
```

All green. Then commit, and run:

```
DRY_RUN=1 bash apps/web/deploy.sh HEAD
```

It must end with `DRY_RUN=1: not uploading` and no error. Paste its last five lines into the report.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `.packets/reports/wc-10b-console-fixes.md` in your worktree and commit it, saying what changed and what each new test proves.
