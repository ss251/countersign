> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2210: what the Whitechain prize rules change

From the project lead at about 22:10 IST, after reading the Whitechain prize page properly.

## The tracks

| Track | Prize | Our position |
|---|---|---|
| Operate | 5k | Enter |
| Tokenize | 4k | — |
| Scale | 3k | Enter: our strongest |

## Two rules that outrank everything else said about Whitechain

1. **Operate says plainly that "payroll, escrow and revenue splits on their own" will not place.** So on Whitechain we never present escrow as the product.
   - We present a **merchant checkout with one-click refunds and an accountant export**.
   - Escrow is the mechanism underneath.
   - Every Whitechain-facing word gets checked against this: the README, the pitch, the demo script and the Whitechain docs.
2. **Operate and Scale both require a drop-in piece that a separate demo app adds in about twenty lines, and both views in the demo.**
   - **Scale is our strongest track.** The payer holds zero WBT, and the relay pays the gas.
   - It must show **how the business funds the relayer and what stops it being drained**. We have all of that; it has to be on screen.

## The work, with owners

| # | Item | Owner | Done when |
|---|---|---|---|
| W1 | **`examples/whitechain-checkout`.** A separate tiny app that integrates our paywall (`whitechainPaywall`) or pay-fetch (`createPayFetch`) in twenty lines or fewer. It has a customer view and a merchant view, a one-click refund and a CSV export, and it hits the **live relay, not a fixture**. | cs-wc. A DeepSeek packet on the Mac; the design is cs-wc's. | The integration diff is twenty lines or fewer, and the line count is shown in its README. A real USDT payment settles through it on chain 1874. A one-click refund moves the USDT back on chain. The CSV holds those rows. Explorer links for each. |
| W2 | **The public merchant desk can actually refund.** Today it shows orders and cannot refund them, and refunding is exactly the "past the first payment" credit the rules ask for. | cs-ui (the desk: the merchant's connected wallet signs the payee refund or cancel) with cs-wc (the relay path that submits it) | On the live console, a merchant refunds a real Whitechain order from the desk, and the explorer shows the refund. |
| W3 | **README, one short section per track entered.** Each covers the twenty-line drop-in, both views, the refund and the export. The Scale paragraph also covers relayer funding, the allowlist, the fee cap, the hourly ceiling and the balance floor. | cs-readme with cs-wc | Every claim carries an artefact under the reality rule. |
| W4 | **The contract.** #164 is not deployable: Grok found two new highs on top of the four already fixed (STEER-2205). | orch-cs, cs-30 and the Lock packets; cs-wc for 1874 | See below. |

**W4 in full:**

1. Fix the highs.
2. Add tests that fail on the current branch.
3. Deploy on Arc and Whitechain.
4. Verify both on their explorers: Arc's explorer, and Blockscout for 1874.
5. Update `docs/proof.md` and the README with the new addresses.

**Nothing on Whitechain counts until a USDT payment settles through the new contract and the explorer shows it.**

## Order

1. The contract fixes (STEER-2205), because W1 and W2 build on the deployed contract's refund path.
2. W1 starts now against the live v1 relay: refunds work there already, through payee-signed cancels. It switches to v2 with wc-09.
3. Then W2, then W3.

The Privy production purchase keeps its slot.

## Amendment, project lead ~22:15 IST: no throwaway trophy app. This replaces W1 and folds W2 into it.

The drop-in must be how our own merchant console actually works, not a separate demo built to satisfy a judge.

1. **The merchant console calls our own paywall and pay-fetch packages for every checkout it serves.** So the twenty-line integration is the product's real integration path, and we dogfood it.
2. **The merchant screen carries a short "integrate this in twenty lines" block**, with a copyable snippet that points at the published package.
   - The snippet is generated from the code we actually run, so it cannot drift: for example, the block renders the same file the console imports, or a build step extracts it.
   - A test fails if the two ever differ.
3. **The only thing under `examples/` is that snippet, as a test fixture** that the suite compiles and runs against the live relay. It is not a separate app with its own UI.
4. **Merchant refund and CSV export become real console actions on the live order list.** That is the "past the first payment" credit, and it is also just the product being finished.
5. **The demo shows one merchant screen** serving a customer, refunding and exporting, with the integration block visible. That satisfies both views and the twenty-line claim without inventing anything.
6. **Scale works the same way.** The relayer's funding and its guards (allowlist, fee cap, hourly ceiling, balance floor, how the business tops it up) are shown from **the merchant console's own relayer panel**, reading the live relay, not from a bespoke slide.

**Owners:**
- cs-wc: the console checkout's use of the paywall and pay-fetch packages, the relay side of refunds, the relayer panel's data, and the snippet fixture under `examples/`.
- cs-ui: the merchant screen (the integration block, refund and export on the live order list, the relayer panel).
- cs-readme: the README per track, pointing at the console, not at an example app.

**The artefact:** a merchant refund live on production, shown on the explorer. The firstmate reports it to the project lead the moment it exists.

**Blocked input, with the project lead:** `@countersign/relay` is not published. It is `"private": true` at version 0.0.0, and npm has no such package. So a snippet "pointing at the published package" would be a false claim under the reality rule until it is published, either to npm or as a packed tarball on a GitHub release. Until he answers, the snippet imports the workspace package, and the block says so plainly.
