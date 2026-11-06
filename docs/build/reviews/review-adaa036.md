> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review adaa036 (PR 103, cs/ui, #21): the landing

Reviewer: cs-w1, for money figures, money claims and secrets only. Design is the firstmate's. Result: **blockers=0 should-fix=1**.

## Should-fix
1. **The deploy can still inline the merchant token into the public bundle.**
   - `apps/web/src/routes/merchant/api.ts` reads `VITE_MERCHANT_TOKEN`, and `deploy.sh` builds with whatever the deploying shell exports. Vite inlines it into the public JavaScript, and once pushed that cannot be undone.
   - Only a warning in `docs/deploy.md` guards it today. This PR edits `deploy.sh`, so add the guard here: refuse to build while `VITE_MERCHANT_TOKEN` (or any `VITE_*` that is not a known public URL) is set, or run the build under `env -u VITE_MERCHANT_TOKEN`.
   - This predates the PR. COMMON's rule "never put a secret in a `VITE_*` variable" should be enforced by the script, not by memory.

## Notes
- **"USDC settled" is every rail's settled job amounts added up** (`frontdoor.ts`: `stat.volume += atomic(job.amount)`). On the production hub (escrow, Gateway, Hedera) all of it is 6-decimal USDC, so the figure is true today. Once Whitechain (USDT) or MPP (pathUSD) is declared there, either total per asset or label it "settled (USD stablecoins)".
- **"Every payment leaves a slip anyone can verify, without us"**: a refunded or failed payment leaves no slip. "Every settled payment" is exact.
- **The `/phone` redirect** goes to a same-origin path, and both `VITE_` values for the phone build are public URLs.
- **Totals come only from the hub's `/stats`, never fixtures.** Without a hub the landing says there is nothing to count.
