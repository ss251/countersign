# hd-09b-mcp-whole-amounts: the Hedera Agent Kit offer refuses fractional amounts before payment, and the buyer sees the transaction it bought

## Goal

This is the single corrective for hd-09, tracked by issue #42. hd-09 was live-tested against the production hub, and one call exposed a hole.

- **The failing call.** A buyer sent `transfers: [{ accountId: "0.0.11337065", amount: 0.01 }]`. The offer's input schema, copied from the tool, says `amount` is a `number`, so the hub accepted the input and the payment settled (0.03 USDC, tx `0.0.9185802@1793968507.953096251`).
- **Why it failed.** The runner hashes every job input with core's `canonicalJson`, which accepts only safe integers. Hashing threw (`$.transfers[0].amount: only safe integers are canonical, got 0.01`), so the delivery failed after the buyer had paid.
- **The same call with `amount: 1`** worked end to end.

The decided fix: the offer advertises only what the runner can serve. Every `number` in the tool's input schema becomes `integer` in the offer, so the hub's input gate refuses a fractional amount before any payment, with 422 `bad-input`. Amounts are whole HBAR. Separately, the buyer's evidence shows the full output and decodes the unsigned transaction it bought.

## Lease

- `packages/rail/src/hedera/mcp-schema.ts` (new) and `packages/rail/src/hedera/test/mcp-schema.test.ts` (new)
- `scripts/hedera/mcp-seller.ts`: the schema step and the summary only
- `scripts/hedera/agent-run.ts`: the `output` evidence and one new `decoded` evidence line
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-09b-mcp-whole-amounts.md`

## Required

1. **`mcp-schema.ts`** exports `offerInputSchema(toolSchema: unknown): JsonSchema`. It returns a deep copy in which:
   - every `$schema` key is removed, which moves the existing `stripDollarSchema` logic here;
   - every `type: "number"` becomes `type: "integer"`;
   - every `type` array containing `"number"` has it replaced by `"integer"`, without duplicates;
   - nothing else changes.
2. **`mcp-seller.ts`:**
   - `inputSchema()` uses `offerInputSchema(tool.inputSchema)`, and the old `stripSchema`/`stripDollarSchema` go;
   - the existing sample check with core `checkSchema` stays, and its sample uses `amount: 1`;
   - the offer summary gains one sentence: "Amounts are whole HBAR."
3. **`agent-run.ts`:**
   - **`output` evidence.** The full `canonicalJson(output)`, with no cut.
   - **`decoded` evidence.** When `output.result.bytes` is `{ type: "Buffer", data: number[] }`, decode those bytes with `Transaction.fromBytes` from `@hiero-ledger/sdk`, which the hedera scripts already use, and add `{ label: "decoded", value: "<TransactionClass> payer <transactionId.accountId> hbar <account amount, …> memo <memo>" }`.
     - For a `TransferTransaction`, list `hbarTransfers` as `0.0.x <amount in HBAR>`, comma-separated.
     - If decoding throws, add `{ label: "decoded", value: "not decodable: <message>" }` and carry on.

## Tests (offline)

`packages/rail/src/hedera/test/mcp-schema.test.ts`:

- a nested schema shaped like the tool's (`transfers` is an array of objects with `amount: { type: "number" }`, plus `$schema` at two levels) comes back with `amount` typed `integer` and no `$schema` anywhere;
- `type: ["number", "null"]` becomes `["integer", "null"]`;
- strings, booleans, `required` and `description` are untouched;
- core `checkSchema` accepts `{ transfers: [{ accountId: "0.0.11337065", amount: 1 }] }` and refuses `amount: 0.01` against the result.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No live runs.** Never run `mcp-seller.ts`, `agent-run.ts` or any script that reads the key file or touches a hub or Hedera. No network in tests. No keys.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. TypeScript strict, no `any`.

## Acceptance

```
bun install && bun run typecheck && bun test packages/rail/src/hedera packages/runner && bun test
```

Every command passes, with no new skips. Commit on `cs/hd-09b` with short present-tense messages ending `refs #42`, and no trailers. Write the report. Do not push, merge or deploy.
