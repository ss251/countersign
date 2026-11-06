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

The envelope's `askAbove` is the one control that stops an agent spending without a person. cs-w1 found (B12) that the first version of remote approvals let the hub's answer clear it: `GET /approvals/:id` said `countersign`, and the agent signed. The hub is the party every earlier fix treats as hostile, so its word cannot stand in for the human.

Rule:

- The envelope names an `approver` key, set by the human when the envelope is written. Without one, a held call can be approved only on the agent's machine.
- The phone signs the decision with that key over `{approvalId, agent, offerHash, amount, rail, termsHash, decision, decidedAt}`.
- The agent rebuilds that body from its own request values, never from the hub's copy, and checks both the signer and the time window before it signs a payment.
- The hub also checks the signature against the approver in the agent's mirrored envelope, which keeps junk out of its table. The agent's check is the one that counts.
- The bearer token stays as the hub's way to accept a decision from the phone and to guard the envelope and approval reads, but it proves nothing to the agent.
- Cap, per-merchant limits and the allowlist are still checked locally before any request is made, so an approval can only lift the ask-above hold.
