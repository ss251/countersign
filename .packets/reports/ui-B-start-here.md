# ui-B-start-here — report

## What shipped

`/start` is a desk screen with one title, one lead, and three hairline-ruled sections:

- **I want a wallet** — the copy the packet fixed, with `WalletButton` rendered inline.
- **I want to sell** — the seller copy and a `Publish a tool` link to `/seller`.
- **I want to buy** — the real path, from the hub's live listing to a signature the hub verifies.

The buyer section picks the first `listed`, `online` offer whose rails include `escrow`, preferring `use-arc`; shows its title, price as `Amount`, and seller; and then follows the wallet state: connect, switch to Arc testnet, or countersign and buy. The buy button reads `Signing` and then `Sending to the hub` while work is in flight, and is disabled.

The request path is:

1. `POST /offers/:hash/call` with `{ input: { question: "What does countersign do?" } }`; the 402 is read from the body or the `PAYMENT-REQUIRED` header.
2. `trustedRequirement` takes the `countersign` / `eip155:5042002` entry. If `extra.escrow` names anything other than the pin, it refuses before a signature exists.
3. `buildAuthorization` signs core's own `authorizationTypedData`: the pin's chain, escrow, USDC token, name and version; `req.payTo`, `req.amount`, `extra.offerHash`, `now + extra.deadlineSeconds`, and `now + 600` for the authorization window.
4. The wallet signs; `countersignPayload` goes back in `PAYMENT-SIGNATURE`.
5. Only the hub's answer is shown:
   - **200** — the settle transaction linked to `https://testnet.arcscan.app/tx/<tx>`, and the slip's `Check it without us` link to `/verify/<slipHash>`;
   - **refusal/error** — the hub's own `message` (or its 402 `error`) verbatim, with the Circle faucet link when the message names balance/funds/allowance/insufficient or the status is 402 again.

No success is rendered unless the hub answered it. Network failures say only that the page cannot confirm what happened.

### The salt, deliberately

Core's `CountersignTerms.salt` is a decimal uint256 (`parseAtomic` rejects a `0x` string). `randomSalt` draws 32 bytes with `crypto.getRandomValues` as `0x` hex as the packet asks; `buildAuthorization` renders that integer as decimal before core hashes it. A raw `0x` salt would throw inside `jobIdOf`, so no wallet could sign. Rendering the same 32 bytes as decimal keeps core's typed data and the hub's jobId identical to the agent's own.

## Files changed (all inside the lease)

- `apps/web/src/lib/arc-pin.ts` (new) — the Arc entry of `KNOWN_RAILS`, with the required header, as a pin.
- `apps/web/src/routes/start/index.tsx` (new) — the route, `trustedRequirement`, `buildAuthorization`, `pickListing`, and the buyer flow.
- `apps/web/src/routes/start/start.css` (new) — token-only styles; ruled sections, mono signatures and hashes, blue only on the in-flight amount and the transaction link.
- `apps/web/test/start.test.ts` (new) — the pin's fields and terms, typed-data equality with core, and the foreign-escrow refusal.
- `.packets/reports/ui-B-start-here.md` — this report.

No `packages/**`, `apps/hub/**`, `App.tsx`, `shell.css`, or `WalletButton.tsx` changes. No new dependencies, no private keys, no browser.

## Verification

From the worktree root, exactly the acceptance chain:

```
bun install                                          # no changes
bun run typecheck                                    # pass
bun test apps/web/test                               # 151 pass, 3 skip, 0 fail
(cd apps/web && bunx --bun vite build)               # pass
```

The 3 skips are the pre-existing live-chain suite in `apps/web/test/onchain.live.test.ts`, gated on `CS_LIVE=1`. The Vite build prints the usual pre-existing `node:worker_threads` externalization note from viem's bundled `ox` chain data; it does not fail the build.

## Needs browser

The route was not visually checked here: no browser of any kind was launched. Lane: **NEEDS-BROWSER** for `/start`, especially the ruled section rhythm, the inline wallet control, the offer line, and the wrong-chain / signing / sending / paid / refused states. A real paid signature needs a funded Arc testnet wallet; an unfunded one should show the hub's refusal and the Circle faucet link.
