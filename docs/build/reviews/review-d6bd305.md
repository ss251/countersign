> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review d6bd305 (PR 196, now carrying #187, #190, A1+A3 and STEER-2225's wallet hygiene)

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. The delta since my clears of 251c743 (#196) and 340a4e7 (#190) is #190's fixes (63d81e8 and 1280556), the merge, and d6bd305.

## #190's should-fix is done
- `embeddedWallets.showWalletUIs: true` is pinned in code, so the embedded wallet always shows its prompt before it signs, whatever the dashboard says.
- A tab whose email sign-in failed to start now offers "Try email sign-in again", which clears the remembered failure and reloads.

## STEER-2225 hygiene
1. **Nothing touches a wallet on load.** Both wagmi providers set `reconnectOnMount={false}`.
2. **The wallet opens only from a review.** The purchase now goes idle, then asking (the 402), then review, then signing, then sending.
   - The review shows exactly what is about to be signed: the offer and its hash, the payee, the amount, the chain, the escrow, and the one job id the authorization can fund (its nonce).
   - These come from the B24-gated terms. `trustedRequirement(required.accepts, listing)` still runs before review.
   - `confirm()` refuses if the wallet's address or chain changed since the review, so nothing is signed for another buyer.
3. **The deploy refuses a drainer-shaped bundle.** `deploy.sh` runs `wallet-grep.ts` on the built `dist`, before the source maps are dropped. It fails on:
   - an approve, increaseAllowance, setApprovalForAll or permit selector anywhere;
   - our own code calling those functions, or using eth_sign, personal_sign or eth_requestAccounts.
   - I built this head. The grep found nothing in 83 bundle files (82 with source maps) and exited 0.
   - With `dist` present, `wallet-hygiene.test.ts` gives 9 pass and 0 fail. Its bundle test is skipped in a plain unit run only because no `dist` exists, and the deploy gate covers that.

## Checks
- `w1-start-terms.test.ts` (B24) gives 4 pass and 0 fail on this head.
- `bun test apps/web` gives 188 pass, 0 fail and 4 skip (the CS_LIVE suite, plus the bundle test without `dist`).
- Lockfile against current cs/int: no name@version is removed and 104 are added (Privy's tree). Only `apps/web/package.json` changes.

## Note
The review freezes the terms when it is shown, including the deadline and therefore the job id. If someone sits on it past the offer's deadline, the hub refuses the signed call and the page shows that refusal. Nothing is lost.
