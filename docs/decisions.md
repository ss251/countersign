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

Status: decided, and built on a branch in review (#21). Not on `main`: today a held call is cleared only on the agent's machine, with `buy --approve`.

The envelope's `askAbove` is the one control that stops an agent spending without a person. cs-w1 found (B12) that the first version of remote approvals let the hub's answer clear it: `GET /approvals/:id` said `countersign`, and the agent signed. The hub is the party every earlier fix treats as hostile, so its word cannot stand in for the human.

Rule:

- The envelope names an `approver` key, set by the human when the envelope is written. Without one, a held call can be approved only on the agent's machine.
- The phone signs the decision with that key over `{approvalId, agent, offerHash, amount, rail, termsHash, decision, decidedAt}`.
- The agent rebuilds that body from its own request values, never from the hub's copy, and checks both the signer and the time window before it signs a payment.
- The hub also checks the signature against the approver in the agent's mirrored envelope, which keeps junk out of its table. The agent's check is the one that counts.
- The bearer token stays as the hub's way to accept a decision from the phone and to guard the envelope and approval reads, but it proves nothing to the agent.
- Cap, per-merchant limits and the allowlist are still checked locally before any request is made, so an approval can only lift the ask-above hold.

## D11 — collect the declared bond, and let only the hub's gate take it (06 Nov; refs #93)

Status: built on a branch (#93), not merged and not deployed. No deployed contract collects the bond yet.

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

Status: built on a branch in review (#94). Not on `main`.

The rail router (`chooseRail`) picks the cheapest eligible rail, healthy first, and falls back when a challenge or a settle fails.

- **Where the trace goes.** Its record of the chosen rail, the reason and each attempt sits in `slip.settlement.route`, outside the committed body, like `settlement.receipt`.
- **Why.** The seller does not attest the route: the hub chooses it and records it. Putting it inside the body would have the seller sign a claim about the hub's choice.
- **What it does not change.** `slipCommitHash` is the same, and so is the slip hash on chain.
- **Where to read it.** `/healthz` shows the policy and the recent decisions.

## D10, amended — one human decision clears exactly one held call (06 Nov; refs #21)

Status: decided; the fix is on the same branch as D10 (#21). Not on `main`.

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
- A headless browser for the e2e `web` flow. No browser runs on the build machine, so the screens are checked by hand in a real browser at 390 and 1440 px, light and dark.
