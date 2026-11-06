# ui-B-start-here: one screen for the three roles, and a buyer path that ends in a real signature the hub verifies (refs #21, STEER-2058 fix 2, STEER-2120 item 1)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-B`, cut from `cs/ui-A` (wagmi with the injected connector, and `WalletButton` in the shell).

## The project lead's words

"A single 'start here' route that explains the three roles in one screen: I want a wallet, I want to sell, I want to buy. The buyer path ends in a real signature."

The signature is a real one from the connected wallet, and the hub verifies it. It is the countersignature on a live Arc offer, built with core's own typed data: the same bytes the agent signs. A wallet without testnet USDC gets the hub's honest refusal and a faucet link, never a fake success.

The reality rule (STEER-2120) applies: no copy claims more than the hub's answer shows.

## The design is decided (cs-ui)

### 1. The route

A new `apps/web/src/routes/start/index.tsx`. Routes are discovered from `routes/*/index.tsx`, so this file is `/start`. It is a desk surface.

- **Title** (`page__title`): `Start here.`
- **Lead:** `countersign lets an AI agent pay for tools inside limits you sign. Pick what you came to do.`
- **Three sections** in one column, ruled with hairlines, each with an `h2`.

### 2. "I want a wallet"

- **Text:** `Connect the wallet you have. Everything here runs on Arc testnet with test USDC, so nothing costs real money.`
- Render `<WalletButton />` (from `apps/web/src/ui/WalletButton.tsx`) inline.

### 3. "I want to sell"

- **Text:** `Publish a tool once and get paid per call, inside each buyer's limits. Your code and keys stay on your machine.`
- A link `Publish a tool` to `/seller`.

### 4. "I want to buy", the real path

`<section data-testid="start-buy">`. Use wagmi's `useAccount`, `useSwitchChain` and `useSignTypedData`. Steps, in order:

1. **The offer.**
   - Read `api.listings()`. Take the first listing that is `status === "listed"`, `online`, and has `"escrow"` in `offer.rails`, preferring the one titled `use-arc`.
   - Show its title, price as `Amount` and seller name, in `data-testid="start-offer"`.
   - With none, show `No live Arc offer is listed on this hub right now.` and stop.
2. **Connect.** When not connected, show `Connect a wallet above to buy.` and no button.
   - When connected on a chain other than `5042002`, show a button `Switch to Arc testnet`.
3. **Countersign and buy** (`data-testid="start-countersign"`), enabled only when connected on `5042002`:
   1. `POST ${hubBase()}/offers/${listing.hash}/call` with JSON `{ input: { question: "What does countersign do?" } }`.
      - Expect 402. Read `PaymentRequired` from the body, or from the `PAYMENT-REQUIRED` header with `fromBase64Json`, as `packages/buyer/src/hub-client.ts` does.
   2. Pick `req = accepts.find((r) => r.scheme === "countersign" && r.network === "eip155:5042002")`. With none, refuse: `This hub offered no Arc countersign terms for this offer.`
   3. **Pin the escrow,** never trusting the hub. Copy the Arc entry of `KNOWN_RAILS` from `packages/buyer/src/known-rails.ts` into a new `apps/web/src/lib/arc-pin.ts` with the header `/* Copied from packages/buyer/src/known-rails.ts: keep equal. */`. Its values: `chainId 5042002`, `escrow 0x19c27d770969291e6a0a305dc1be1a845e7c1b76`, `token 0x3600000000000000000000000000000000000000`, `tokenName "USDC"`, `tokenVersion "2"`.
      - If `req.extra` names an escrow and it is not the pin's, refuse: `The hub's terms name an escrow this page does not trust, so nothing was signed.`
   4. **Build the authorization exactly as `packages/buyer/src/payer.ts` (`escrowPayer.pay`) does:**
      - terms `{ offerHash: extra.offerHash, buyer: address, payee: req.payTo, amount: req.amount, deadline: now + extra.deadlineSeconds, salt }`, with `salt` 32 random bytes as 0x hex from `crypto.getRandomValues`;
      - `input = { terms, chainId, escrow, token, tokenName, tokenVersion, validAfter: 0, validBefore: now + 600 }`;
      - `now` is unix seconds.
   5. `sig = await signTypedDataAsync(authorizationTypedData(input))`, with `authorizationTypedData` from `@countersign/core`.
      - Show `Signed by your wallet` and the short signature in `data-testid="start-signature"`.
      - A rejection shows `The wallet did not sign, so nothing was sent.`
   6. `payment = { x402Version: 2, accepted: req, payload: countersignPayload(input, sig) }`.
      - `POST` the call again with the header `PAYMENT-SIGNATURE: toBase64Json(payment)`. `PAYMENT_SIGNATURE_HEADER`, `toBase64Json` and `countersignPayload` come from `@countersign/core`.
4. **The hub's answer,** shown exactly:
   - **200 (paid):**
     - The `PAYMENT-RESPONSE` header (`fromBase64Json`) carries the settle result. Show its transaction as a `Hash` linked to `https://testnet.arcscan.app/tx/<tx>`, in `data-testid="start-fund-result"`, under the words `The escrow holds your payment until the output checks out.`
     - If the result names a slip hash, show it in `data-testid="start-slip"` with a link `Check it without us` to `/verify/<slipHash>` (`data-testid="start-verify"`).
   - **Any refusal or error:**
     - Show the hub's own `message` verbatim, in `data-testid="start-refusal"`, under the words `The hub refused, and nothing moved:`.
     - If the message mentions balance, funds, allowance or insufficient, or the status is 402 again, add `Get test USDC for Arc at the Circle faucet`, linking to `https://faucet.circle.com` (`data-testid="start-faucet"`, `target="_blank" rel="noreferrer"`).
   - **Never** a success the hub did not answer.
5. **Sending.** While a request is in flight, the button reads `Signing` or `Sending to the hub` and is disabled.

### 5. Styles (`apps/web/src/routes/start/start.css`, new)

Use tokens only. Sections are ruled with `border-top: var(--hair) solid var(--line)`, `padding: var(--sp-8) 0`. The signature and hashes are mono. Blue only on the amount in flight and the tx link. No gradients and no cards.

## Lease

You may create or change only:

- `apps/web/src/routes/start/index.tsx` and `apps/web/src/routes/start/start.css` (new);
- `apps/web/src/lib/arc-pin.ts` (new);
- `apps/web/test/start.test.ts` (new);
- `.packets/reports/ui-B-start-here.md`.

## Tests (`apps/web/test/start.test.ts`)

No browser and no network. Factor the request building into an exported pure function in `apps/web/src/routes/start/index.tsx`: `buildAuthorization(req, address, nowSeconds, salt)`, returning the `AuthorizationInput`. Test:

- it uses the pin's escrow, token, name and version, `req.payTo` as payee, `req.amount`, `extra.offerHash`, `deadline = now + extra.deadlineSeconds` and `validBefore = now + 600`;
- `authorizationTypedData(buildAuthorization(...))` equals what core builds for the same terms;
- a requirement whose `extra.escrow` is not the pin's is refused by an exported `trustedRequirement(accepts)`.

Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never touch `packages/**`, `apps/hub/**`, `App.tsx`, `shell.css` or `WalletButton.tsx`.
- No new dependencies. TypeScript strict, no `any`. No private key anywhere; the wallet signs.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-B-start-here.md`. Do not push, merge or deploy.
