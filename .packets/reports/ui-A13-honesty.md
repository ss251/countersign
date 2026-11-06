# ui-A13-honesty — report

## What shipped

### A1 — the offer page says each rail's own terms

- `apps/web/src/lib/terms.ts` adds `TermsKind`, `termsKind`, `railTermLines`, `failedDeliveryNote` and `deadlineWords`. The terms come only from a rail's `RailDeclaration`: an escrow kind with a contract address is escrow, an escrow kind without one (Hedera's scheduled rail) is held, and direct and batched keep their own kinds.
- `apps/web/src/routes/offer/OfferTerms.tsx` renders one `div.terms__rail` per rail in the offer's order, with `RAIL_LABEL[id]` and a `dl.terms` of the declaration's own `[term, sentence]` pairs. The offer page no longer promises escrow, refund and release unconditionally: the three fixed rows are gone.
- The example response's failed-delivery note is `failedDeliveryNote` over the offer's rail kinds, so only an all-escrow offer promises the money back.
- `curlCommand` now sends `{"input": <example>}`, the body `apps/hub/src/call.ts` reads; `buyCommand` is unchanged.
- `RailCard`'s "How" row is keyed by `termsKind`, so the held Hedera schedule says "Held." instead of the escrow release-or-refund line.

### A3 — the assistant's card either signs for real or says it signs nothing

- `apps/web/src/lib/purchase.ts` now holds the whole `/start` purchase path — `trustedRequirement`, `buildAuthorization`, the salts, the call/response helpers, `PurchasePhase`, `PurchaseOutcome` — and a `usePurchase()` hook that reads `useAccount` and `useSignTypedData`. `postCall` takes the call's `input` instead of the fixed question.
- `apps/web/src/ui/PurchaseResult.tsx` renders the signature, note, paid and refused states with the same words and links as before, under `start-*` or `pcard-*` test ids. Its styles live in `ui/purchase.css`; the moved `start__*` rules are gone from `start.css`.
- `/start` renders the same screen through the hook and `PurchaseResult`, with every existing `start-*` test id.
- `apps/web/src/routes/assistant/cardMode.ts` decides the card's mode from the wallet, chain and offer rails. On Arc testnet with an escrow offer the hold calls `usePurchase().buy(listing.hash, exampleInput(offer.input))`, shows the input and the signing/sending phases, then the hub's own result. Otherwise the card's hold yields the agent's command, its labels never say "Countersigned", and a connected wallet on the wrong chain gets the why line and a switch button.

## Tests

- `apps/web/test/terms.test.ts` covers the four kinds, the audit render of a gateway + hedera offer (no escrow/refund/release-gated words), escrow and held renders, `failedDeliveryNote`, `deadlineWords`, the curl body, and `RailCard`'s held line.
- `apps/web/test/cardMode.test.ts` covers the four modes with their exact reasons.
- `apps/web/test/start.test.ts` only changes its import to `lib/purchase.ts`; every assertion is unchanged.

## Verification

From the worktree root, the acceptance chain:

```
bun install --linker hoisted   # no changes
bun run typecheck              # pass
bun test apps/web/test         # 170 pass, 3 skip, 0 fail
(cd apps/web && bunx --bun vite build)   # pass
```

The full `bun test` also passes: 1174 pass, 3 skip, 0 fail. The 3 skips are the existing live-chain suite gated on `CS_LIVE=1`. The build prints the pre-existing `node:worker_threads` externalization note from viem's bundled `ox` chain data; it does not fail.

## Needs browser

No browser of any kind was launched. Lane: **NEEDS-BROWSER** for the offer terms section with gateway + hedera and with the held schedule, and for the assistant card's labelled, wrong-chain, wallet-signing, sending, paid, refused and "Hold again" states. A real paid signature needs a funded Arc testnet wallet.

## Lease

Only the files in the packet were created or changed. No `packages/**`, `apps/hub/**`, `App.tsx`, `shell.css`, `WalletButton.tsx`, `wallet.ts` or `HoldToSign.tsx` changes. No new dependencies, no private keys, no browser.
