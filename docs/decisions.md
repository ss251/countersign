# Decisions

One entry per decision that someone could reasonably have made the other way. Newest at the bottom.

## D1 — one root tsconfig, one root foundry.toml

Bun workspaces cover `apps/*` and `packages/*`. A single `tsconfig.json` at the root typechecks every workspace, and `foundry.toml` sits at the root with its paths pointing into `contracts/`. The gate is `bun run typecheck && bun test && forge test`, run from the root, with nothing to `cd` into.

## D2 — Solidity dependencies come from `bun install`

OpenZeppelin 5.6.1 comes from npm and forge-std from its v1.17.0 tag on GitHub, both as root dev dependencies with explicit remappings. There are no git submodules, so every worktree gets a compiling contracts tree from `bun install` alone.

## D3 — `evm_version = "cancun"`

The same escrow bytecode deploys to Arc and to Whitechain Sepolia. OpenZeppelin 5.6's SignatureChecker uses MCOPY, so paris is out. On 06 Nov both chains' latest blocks carried `blobGasUsed`, `parentBeaconBlockRoot` and `requestsHash`, which means Prague-era headers, so cancun bytecode runs on both.

## D4 — amounts are bigint in code, digit strings on the wire

An amount is a bigint of the token's smallest unit everywhere in TypeScript. In JSON it is a base-10 digit string with no sign, no leading zeros and no exponent. Canonical JSON refuses non-integer numbers outright, so a float can never reach a hash or a signature.

## D5 — canonical JSON is a strict subset of RFC 8785

Keys are sorted by UTF-16 code unit, there is no whitespace, strings are escaped as `JSON.stringify` escapes them, and only safe integers are allowed as numbers. Hashes are keccak256 over the UTF-8 bytes. Anything with two possible spellings is an error rather than a normalisation.

## D6 — the live console is on Railway; the Studio project URL is a risk, not a pass (06 Nov)

The Arc Studio project is app `16e0b317-ec5f-406a-8d7d-24bf6d96533b` at `https://studio.arc.io/app/16e0b317-ec5f-406a-8d7d-24bf6d96533b`. In a clean browser profile that URL redirects to the Studio landing page. Studio's Share control only offers to deploy the app through Netlify, Hugging Face or Vercel, and it says a link anyone can open exists only after such a deploy. Studio has no public-project switch, and the `arc-studio` CLI has no share command.

By captain decision (15:30 IST), the console a judge opens runs on Railway, in a new project `countersign`. The README carries both the Railway console URL and the Studio project URL, and Studio appears on screen in the video. Until a Studio-native public link exists, the Arc requirement for a shareable Studio project URL is **at risk**, not met. Nothing in this repository claims otherwise.

## D7 — escrow pulls with receiveWithAuthorization, and the payee can cancel early (06 Nov)

PLAN §6 says the escrow pulls by `transferWithAuthorization`. It uses `receiveWithAuthorization` instead: the buyer signs the same EIP-3009 message, but only the escrow can submit it. With `transferWithAuthorization`, anyone holding the signature could move the buyer's funds into the escrow without opening a job. `cancel(jobId, sellerSig)` was added so the payee can hand the money back before the deadline, which is the merchant's one-click refund on Whitechain.

## D8 — the hub settles Arc calls through the escrow Arc Studio deployed (06 Nov; refs #1)

`arc-studio deployments` for the countersign app listed nothing while the escrow lived only at the `forge script` address `0x44d11b8909485e3f575F6628b689383E4420f54a`. So we sent the three contract files into the Studio session unchanged. Studio reviewed them, wrote its own Foundry tests (43 pass) and deployed `FeeSplit` `0xbf9de410d4a17781df0d9d3dd160018aceb3fe87` and `CountersignedEscrow` `0x19c27d770969291e6a0a305dc1be1a845e7c1b76` on Arc testnet, with solc 0.8.28, 200 runs and cancun, the same settings as `foundry.toml`. We pulled the sources back and diffed them: byte-identical. We read the constructor state on chain: USDC, the new `FeeSplit` with our two payees at 5000/5000, and a 100 bps toll.

From here the hub's `escrow` rail and the buyer's pinned rail table use the Studio-deployed escrow. The forge deployment stays valid and stays in the pinned table. The first live proofs (the 15:19 release and the two refusals) ran on it and are recorded under that address.

## D9 — the slip hash committed on chain is the hash of the body, never of the settlement (06 Nov; refs #37)

The captain approved using the existing on-chain commitment: `release(jobId, slipHash, sellerSig)` stores `job.slipHash` and emits `Released(jobId, slipHash, payee, paid, toll)`. This needs no contract change and no redeploy.

Rule: the committed hash is `keccak256(canonicalJson(slip.body))`. `SlipBody` holds everything known at delivery: the offer, job, parties, amount, input and output hashes, delivery time, children, and the escrow domain. It does not hold the settlement tx, the payment payload, the seller signature or any receipt. A hash over the settlement tx could not exist until the release that commits it was mined, so including it would deadlock release.

The release path never sends `bytes32(0)`. The hash released is exactly `slip.hash`, the hash of the slip the buyer is handed, so the seller signs the very receipt the buyer keeps. With an RPC, the verifier fetches the job's `Released` event and requires `event.slipHash` to equal the hash it recomputes from the body. A tampered body that carries a recomputed `hash` of its own still fails, because the chain holds the original.

## D10 — a held call clears only with the approver's signature, never the hub's word (06 Nov; refs #21)

Status: built (#21). Whether it has reached `main` and production: [status.md](status.md).

The envelope's `askAbove` is the one control that stops an agent spending without a person. cs-w1 found (B12) that the first version of remote approvals let the hub's answer clear it: `GET /approvals/:id` said `countersign`, and the agent signed. The hub is the party every earlier fix treats as hostile, so its word cannot stand in for the human.

Rule:

- The envelope names an `approver` key, set by the human when the envelope is written. Without one, a held call can be approved only on the agent's machine.
- The phone signs the decision with that key over `{approvalId, agent, offerHash, amount, rail, termsHash, decision, decidedAt}`.
- The agent rebuilds that body from its own request values, never from the hub's copy, and checks both the signer and the time window before it signs a payment.
- The hub also checks the signature against the approver in the agent's mirrored envelope, which keeps junk out of its table. The agent's check is the one that counts.
- The bearer token stays as the hub's way to accept a decision from the phone and to guard the envelope and approval reads, but it proves nothing to the agent.
- Cap, per-merchant limits and the allowlist are still checked locally before any request is made, so an approval can only lift the ask-above hold.

## D11 — collect the declared bond, and let only the hub's gate take it (06 Nov; refs #93)

Status: built (#93) and on `main`, not deployed. No deployed contract collects the bond yet. The silence rule below is withdrawn by D15 (audit C2).

The offer always declared a bond, and nothing collected it.

- **The mechanism.** v2 keeps a free bond balance per payee in the escrow. `fundBonded` locks `offer.bond` for the job.
- **When the bond moves.**
  - **The delivery fails the hub's gate:** the arbiter (the hub's relayer) calls `failDelivery`. The buyer gets the payment and the bond back at once.
  - **Every other close returns the bond to the seller:** release, the deadline refund of a silent seller, the payee's cancel, and a buyer's dispute.
- **The property the tests prove.** A failing seller ends exactly one bond worse off than a silent one. Delivering junk costs more than delivering nothing, so a seller who cannot do the work should stay silent rather than ship garbage.
- **Why disputes do not slash.** A dispute is the buyer's own judgement, and there is no arbitration. If disputes slashed, any buyer could take bonds. The gate's checks (output schema, slip signature, committed hash) are mechanical, so only they slash.
- **The trust this leaves.** The arbiter decides gate failure, so a dishonest hub could slash. The bond is exactly as strong as the hub's gate, and `docs/spec/escrow.md` says so.

## D12 — open an optimistic review window at delivery; the buyer accepts, or disputes for a refund (06 Nov; refs #93)

Status: design only. Review and dispute have no code yet (#98).

**The gap.** In v1, the escrow that is deployed, `release` needs only the seller's signature over `jobId` and `slipHash`. The gate checks shape, integrity, seller identity and price, but a seller who delivers junk that passes the schema, signs and takes the money is not stopped.

**The fix.** Each offer may set `reviewWindow` (seconds; 0 keeps v1's behaviour).

- With a window, `release` records the delivery: status Delivered, with the `slipHash` on chain.
- Payment waits for one of two things:
  - the buyer's `accept`, which pays at once; or
  - the window to end, after which anyone may call `releaseAfterWindow`.
- The buyer may `dispute`:
  - before delivery, up to the deadline;
  - after delivery, for the whole window.

  A dispute refunds the payment at once, and the bond goes back to the seller (D11). It does not wait for the deadline, because release is already blocked and there is no arbitration to wait for.
- The deadline refund is unchanged for jobs that were never delivered. A delivered job is never refunded by the deadline: the seller met it.

**The hash.** The review outcome happens after the slip hash is committed, so it cannot be in the committed body. It goes on the settlement side as `slip.settlement.review = {window, deliveredAt, endsAt, outcome?, tx?}`, next to `settlement.receipt`.

- The `Delivered`, `Accepted`, `WindowElapsed`, `Disputed` and `Released` events are the on-chain proof of what happened.
- `Released` keeps its v1 signature, so the verifier's proof holds on both versions.

**Terms.** Bond and window are set at funding by the arbiter (`fundBonded` is arbiter-only), from the offer. The buyer checks both in the 402 before countersigning, and anyone can read them on chain. Binding them into the `Countersign` struct changes `jobId`, so it is left for a later deployment.

The state machine, with who calls what and when, is in `docs/spec/escrow.md`, under "Escrow v2".

## D13 — the router's trace is the hub's record, outside the committed slip hash (06 Nov; refs #94)

Status: built (#94), on `main`.

The rail router (`chooseRail`) picks the cheapest eligible rail, healthy first, and falls back when a challenge or a settle fails.

- **Where the trace goes.** Its record of the chosen rail, the reason and each attempt sits in `slip.settlement.route`, outside the committed body, like `settlement.receipt`.
- **Why.** The seller does not attest the route: the hub chooses it and records it. Putting it inside the body would have the seller sign a claim about the hub's choice.
- **What it does not change.** `slipCommitHash` is the same, and so is the slip hash on chain.
- **Where to read it.** `/healthz` shows the policy and the recent decisions.

## D10, amended — one human decision clears exactly one held call (06 Nov; refs #21)

Status: built with D10 (#21).

cs-w1 found that D10's signed decision bound only values a second call to the same offer repeats (B14). The decision covered agent, offer, amount, rail and terms hash, plus an approval id. The hub chooses that id, so it could answer a new request with an old id and serve the stored decision again: one human yes, two payments above ask-above.

Rule:

- **The request.** The agent's signed approval request carries a fresh random `nonce` (32 bytes, hex). It also carries `title`, `amount`, `terms` and `requestedAt`.
- **The decision.** The decision body is version 2: `{kind, v: 2, approvalId, agent, offerHash, amount, rail, termsHash, requestHash, decision, decidedAt}`.
  - `requestHash` is `keccak256(canonicalJson(request))`, where the request is the agent's signed request without `sig`.
  - The agent rebuilds `requestHash` from its own request, never from the hub's copy. A decision made for any other request, even for the same offer and amount, fails.
- **Consumed ids.** The agent records every approval id it consumes and refuses an id it has seen before.
- **What the phone checks.** The hub stores the whole signed request. The approval view returns it with `requestSig`, so the phone checks that the agent signed exactly what it displays, title included, before it signs. A hub can no longer show the human a different title for the same offer and amount.
- **Body caps.** Every write route caps its body at 16 KiB, including the decision route.

## D14 — five items cut to buy time (06 Nov, 18:12 IST)

With sixteen hours to the deadline, the team dropped these so the build finishes what the demo and the prize rules need. `docs/status.md` lists them as `CUT`.

- Paid sessions.
- Unified balance.
- The subgraph and `/graph/stats` (#4). There is no Goldsky account to deploy it with.
- Railway preview environments for pull requests. If they come back, the preview secrets rule in `docs/deploy.md` still applies.
- A headless browser for the e2e `web` flow. No browser runs on the build machine, so the screens are checked by hand in a real browser at 390 and 1440 px, light and dark. **Un-cut by D14, amended (below).**

## D11, amended — a countersignature can never become a bond deposit; only the arbiter funds a bonded job (06 Nov; refs #93)

cs-w1 found two problems in the first bond build.

- **B16: two functions accepted one signature.** `depositBond` took any `ReceiveWithAuthorization` to the escrow, and a buyer's countersignature is exactly that, with nonce = jobId. Anyone who saw one could spend it as a deposit: the buyer's money became a bond and the job could never be funded.
- **The deploy gate: anyone could lock a seller's bond.** A stranger could fund a job of their own on any seller, with any bond, and lock that seller's whole free bond.

Rule:

- **Domain separation.** The escrow computes the deposit nonce itself: `keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))`, with `BondDeposit(address payee,uint256 amount,bytes32 salt)`.
  - A jobId is an EIP-712 digest, so it never equals a deposit nonce, and a deposit authorization can never fund a job.
  - Deposits stay relayable, so a seller without gas can deposit.
- **Who funds a bonded job.** `fundBonded` is arbiter-only. `fund` (bond 0) stays open to anyone.
- **The buyer's budget.** An on-chain Failed job counts like a refund: the money is back with the buyer.
- **Accepted for this deployment.** The arbiter key can lock and slash any seller's free bond, so a leaked hub key puts every free bond at risk. The bond is exactly as safe as the hub's key, so bonds stay small. Seller-signed locks (`LockBond(jobId, bond)`) are a later revision; the contract is immutable once deployed, so they would need a new deployment.

## D13, amended — the router ranks rails that protect the buyer first, unless the buyer opts in (06 Nov; refs #94)

cs-w1 reviewed the router (bb5f265) and found a policy problem. Ranking by cost alone put the rails that cannot refund the buyer (gateway, hedera, eip3009 and mpp, all of kind `direct` or `batched`) ahead of escrow, because they carry no toll. The buyer takes the first entry it can pay, so it would pay unprotected by default, against the product's promise that payments move only when the work lands.

Rule:

- **Protected first.** A rail is protected when its kind is `escrow`. Without an opt-in, the order is healthy first, then protected before unprotected, then cost, finality and rail id.
- **Opting in.** A buyer opts in with `X-Countersign-Allow-Unprotected: 1`, or by naming an unprotected rail in `X-Countersign-Rails`. Price then competes across both kinds.
- **Nothing is dropped.** Unprotected rails stay listed, so a buyer that can only pay them (a Gateway-only client, the Hedera agent) pays as before.
- **Health is per rail and offer.** One seller's broken offer or one buyer's late signature cannot degrade a rail for everyone else.
- **Bounded attempt logs.** At most 20 attempts are kept per key, and at most 5 are copied into a slip.

## D15 — the escrow audit's fixes: the payee signs its bond, silence forfeits it, the arbiter alone funds (06 Nov, 19:45 IST; refs #98, #93)

Status: design only, in [spec/escrow.md](spec/escrow.md) under "Escrow v2". It is in Rajdeep's contract half of #98, and no escrow is redeployed until its regression tests pass and the captain re-runs the audit.

The captain's audit of the escrow on `main` found four deploy blockers and three lows:

- **C1:** the arbiter and a buyer it controls can take any bonded payee's bond;
- **C2:** a silent seller keeps its bond, so silence is the cheapest strategy;
- **H1:** the arbiter loses jurisdiction at the deadline;
- **M1:** anyone can front-run a bonded funding with an unbonded `fund`.

What is decided:

- **The payee signs each lock.** The payee signs `LockBond(jobId, bond, reviewWindow)`, and the bond is capped at the job's amount. A bond moves only on a job the payee chose to serve, and the arbiter's worst case is that job's bond.
- **Silence forfeits the bond.** A refund after the settle window pays the bond to the buyer. The payee keeps it only by cancelling by the deadline, by a buyer's dispute, or by a release. D11's rule that silence is cheaper than failing is withdrawn: a seller who cannot deliver now says so by cancelling.
- **One settle window after the deadline.** `release` and `failDelivery` may land until `deadline + DISPUTE_WINDOW` (600 s), and `refund` opens after it. The release shares the window so that an honest release mined late does not forfeit its bond.
- **Only the arbiter funds.** It keeps `jobId` and every client's derivation unchanged. Today three kinds of hub submit `fund`: production, the e2e suite's and local ones, on both chains. With one arbiter, the production key, the other hubs stay on the v1 escrows (option (a), the captain's call before the redeploy). Binding bond and window into `Countersign` is the stronger fix, but it changes `jobId`, so it waits for a later revision. Meanwhile the buyer checks `bondOfJob` and `reviewOf` after funding, and disputes at once on a mismatch.
- **The lows.** The toll accrues and anyone can sweep it to the treasury, a payee can never be the escrow, and every time boundary follows one rule: until T means `now <= T`, after T means `now > T`.

## D16 — the captain's 19:40 decisions for escrow v2: terms from signatures, the arbiter fails deliveries only (06 Nov, 19:40 IST; refs #98)

Status: design only, in [spec/escrow.md](spec/escrow.md) under "Escrow v2". Rajdeep writes the contract, and the captain re-runs the audit before any deployment. This supersedes D15 wherever the two differ.

- **Terms.** `bond` and `reviewWindow` come from the published offer into the countersigned `jobId`, and `fund` stays open to anyone with the countersignature. Any other bond or window is another `jobId`, so no front-run can strip them, and M1 is gone. D15's arbiter-only funding, the arbiter-set terms and the payee's per-job lock signature are all withdrawn.
- **The arbiter does `failDelivery` only.** On Arc that is the production hub's relayer, the signer that runs the gate (`0xE37F64A73225f5eA06BABcb1cc5440F01446C267`). On 1874 it is the relay's signer (`0xa2EEfc657138eE5367291F8e2Ac45BAC28486006`).
- **The binding (C1).** The buyer chooses every value in `Countersign`, so a locked bond must match terms the payee itself registered on chain: `setTerms(offerHash, price, bond, reviewWindow, minDuration)`, written by the payee only, with the bond capped at the price. Funding with a non-zero bond or window requires an exact match, and a deadline at least `minDuration` away. Otherwise any buyer could lock any payee's bond and collect it through a default or a dispute.
- **The economics.** A default after `settleBy`, a dispute inside the review window, and a gate failure all pay the buyer `amount + bond`. A dispute before delivery and a cancel by the payee by the deadline return the bond. Disputing before delivery returns the bond so that no buyer can take it before the seller has had a chance to deliver. Aggressive disputes inside the window are the accepted trade.
- **H1 and the lows are unchanged from D15.** There is one settle window of 600 s after the deadline for `release` and `failDelivery`, the toll accrues, a payee can never be the escrow, and every time boundary follows one rule.


## D14, amended — a headless browser comes back, in CI only, for a human end-to-end test (06 Nov, 21:05 IST; captain)

The headless browser is no longer cut. A person has to be able to sign in, connect and buy without instructions, and only a browser driving the deployed app can show that. This test is the acceptance gate for the console work.

- **Its own project.** `e2e/human` is a Playwright project, separate from the fast suite in `e2e/`. It drives the deployed console and hub the way a person does:
  1. sign in;
  2. connect a wallet;
  3. discover an offer and countersign it;
  4. fund the escrow on Arc from that wallet;
  5. let the seller deliver;
  6. verify the slip;
  7. have the merchant refund.
- **Where it runs.** In CI only: on demand (`workflow_dispatch`) and nightly. It never runs on pull requests, and never on the build machine, where the no-browser rule still holds.
- **Its report.** It writes its own report, `e2e/human/runs/LATEST.md`, never `e2e/runs/LATEST.md`. A Privy outage must not turn a green build red.
- **Sign-in.** Sign-in uses Privy (email or passkey, with an embedded wallet on Arc testnet) once its app id and secret are set: `VITE_PRIVY_APP_ID` on the console, and `PRIVY_APP_ID` with `PRIVY_APP_SECRET` on the hub.
  - Without them there is no Privy button, and the console's injected wallet connect is the path.
  - The test then runs that path with a test EIP-1193 provider from a throwaway key.
- **Funding.** The test wallet is funded with 1 USDC on Arc by a dedicated test-funder key before it buys, and the test asserts the balance. The deployer's own key never sits in CI.
- **Status.** `docs/status.md` marks this `IN DESIGN` until the project exists, and `SHIPPED` only when it runs green.

## D17 — a call nested inside a purchase of the same offer or seller is refused before payment (06 Nov; refs #27)

A call's `lineage` lists the jobIds of the purchases it is nested inside, outermost first (`CallRequest` in `packages/core/src/wire.ts`). The hub now uses it for what it was declared for: refusing cycles.

- **The rule.** Before any 402 or payment, the hub resolves each lineage jobId it knows. If an ancestor job bought the same offer, or an offer from the same seller, the call is refused with 409 `lineage-cycle`: "Refused. This call is nested inside a purchase of the same offer or from the same seller, so it would close a cycle. Nothing was charged."
- **Where.** First in the paid-call pipeline, right after the offer is loaded. It runs before the ENS lock, both input gates, the online check and the rails.
- **What it cannot see.** A jobId this hub does not hold, such as a purchase made through another hub, is skipped. A caller that sends no lineage is not checked. Lineage comes from the caller, so the check stops honest agents from looping, not a buyer who hides its ancestry.

## D19 — the hub checks a signed-in person with Privy on the routes that act for them; signatures still authorise money (06 Nov; refs #21)

**When it is on.** Only when `PRIVY_APP_ID` and `PRIVY_APP_SECRET` are both set. Otherwise every route behaves exactly as before, and a Privy header is ignored.

**The token.**
- The console sends the person's Privy access token in `X-Privy-Token`. `Authorization: Bearer` stays the operator's `HUMAN_APPROVAL_TOKEN`.
- The hub verifies the token with `@privy-io/server-auth` (`verifyAuthToken`; the token's app id must be ours), then reads the person's Ethereum wallets with `getUserById`, cached for 60 seconds.
- An invalid token gets 401 and an unreachable Privy gets 503, both before any 402 or payment.

**The routes that act for a person, and what the person must own.**

| Route | A verified person must own |
|---|---|
| `GET /envelopes/:agent` | the approver named in that agent's envelope |
| `GET /approvals?agent=` | the approver named in that agent's envelope |
| `POST /approvals/:id/decision` | the approver named in the envelope of the approval's agent |
| `POST /offers/:offerHash/call` | the payer the rail verified, which must be an EVM address |
| `POST /jobs/:jobId/accept`, `POST /jobs/:jobId/dispute` | the job's buyer |

- **The three approval routes.** A verified person who owns the approver needs no operator token. A caller with no Privy token uses the operator token exactly as before.
- **The other three routes.** The token is optional, because agents call them without one. When a token is sent, it must verify and the person must own the address.

**What the token never does.** It never replaces a signature. The payment signature, the approver's decision signature and the buyer's review signature are checked exactly as before, and they alone authorise money.

**Left out on purpose.**
- `PUT /envelopes/:agent`, `POST /approvals` and `POST /offers` are signed by an agent or a seller key, not by a person.
- The merchant refund is not a hub route: it lives on the merchant's own service.

## D17, amended — a lineage that names the offer or its seller directly is refused too (06 Nov; refs #27)

D17 resolves each lineage jobId through the jobs this hub holds. A lineage entry that is not a jobId, such as the target offer's own hash or its seller's address, was skipped. Now an entry equal to the target's offer hash, or to its seller's address (compared without case), is refused with the same 409 `lineage-cycle`, before any 402. The jobId check is unchanged.

## D20 — the person revokes an agent from the phone, and the hub refuses that agent before any 402 (06 Nov; refs #21)

The envelope lives on the agent's machine, and the agent signs its mirror, so the phone cannot rewrite it. What the person can do from the phone is revoke the agent on the hub, signed by the approver key the envelope names.

**The revoke.**
- `POST /envelopes/:agent/revoke` takes `{revokedAt, sig}`.
- `sig` is the approver's EIP-191 signature over the canonical JSON of `{kind: "countersign-envelope-revoke", v: 1, agent, revokedAt}`. `agent` is lowercase, and `revokedAt` is unix seconds within 300 seconds of the hub's clock.
- The route is gated like an approval decision: a Privy person who owns the approver (D19), or the operator token. The signature is what revokes.

**What the hub does with it.**
- It records the revoke and answers 200 `{agent, revoked: true, revokedAt}`. A second revoke keeps the first.
- `GET /envelopes/:agent` returns `revocation: {revokedAt}`, so the phone reads it back after a reload.

**Enforcement.**
- **Before any 402.** A call whose `X-Countersign-Agent` header names a revoked agent gets 403 `envelope-revoked`: "Refused. This agent's envelope was revoked by its approver. Nothing was charged."
- **At payment, before settle.** A payment whose verified payer is a revoked agent gets the same refusal, so an agent that leaves the header off still moves no money.
- **The buyer.** The buyer CLI sends `X-Countersign-Agent` with its address on every call.

**No reinstating tonight.** A revoked agent stays revoked on this hub. To resume, the person makes a new agent key on the agent's machine, and the agent mirrors a new envelope under it. The phone's other envelope controls (budget, per-seller limit, allowlist) still live on the agent's machine: the phone shows the agent's signed copy and cannot change it.

**Limits.**
- The header is the agent's own claim; the payment check is what binds it.
- A Hedera payer is a Hedera account, not an EVM agent, so it is not covered.

## D18 — a seller delists its own offer, and a canary delists an offer whose runner no longer answers for it (06 Nov; refs #26)

**Delisting by the seller.**
- `POST /offers/:offerHash/delist` takes `{sig}`: the seller's EIP-191 signature over `countersign delist <offerHash>`.
- It answers 200 `{offerHash, status: "delisted"}`, including when the offer was already delisted. An unknown offer gets 404, a malformed request 400, and a signature that is not the offer's seller 401.

**What delisted means.**
- The offer is absent from `GET /offers`, `/offers/search` and every discovery document.
- A call answers 404 before any 402.
- A runner's hello cannot bring it back.
- Publishing the same offer again does not relist it, because its hash is unchanged. A seller relists by publishing a changed offer.

**The canary.**
- It is on when the hub starts with `CANARY=1`, every `CANARY_INTERVAL_S` seconds (default 300).
- It covers every listed offer whose runner is online. The hub sends `{t: "canary", offerHash, nonce}` over that runner's WebSocket.
- A runner that still serves the offer answers `{t: "canary", offerHash, nonce, sig}`, signed by the offer's seller over `countersign canary <offerHash> <nonce>`. Otherwise it answers `{t: "canary-fail", offerHash, nonce, reason}`.
- Each offer gets three attempts, five seconds apart, ten seconds each. An offer whose three attempts all fail is delisted at once, and the hub logs why.
- Offline offers are not canaried: they already answer 503 and sell nothing.

**What the canary proves, and what it does not.** It proves that the runner holding the offer still serves it, and that the seller's key still signs for it. It does not run the offer's work or check its output; a paid delivery still goes through the delivery gate.

**Rollout.** A runner that predates the canary ignores it, so its offers would be delisted. `CANARY=1` goes on in production only after every live runner answers canaries: `packages/runner` with this change, and the phone page separately.
