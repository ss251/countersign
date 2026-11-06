# cs-08-identity — ERC-8004 on Arc testnet: seller identity, operator grant, feedback from slips (refs #2)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

Give every seller an ERC-8004 identity on Arc testnet, let the seller grant the hub an operator role, and let a buyer leave feedback tied to a released slip. Ratings derived later count only feedback whose `feedbackHash` is a released slip's hash from that same buyer, so a rating is earned, not self-reported. This packet builds the library, the ops scripts and the tests. The integrator runs the scripts live with real keys.

## Facts, read live on Arc testnet on 06 Nov

- IdentityRegistry proxy: `0x8004A818BFB912233c491871b3d84c89A494BD9e`. It is ERC-721, upgradeable, and its implementation is verified on the Arc explorer.
  - `register(string agentURI) returns (uint256 agentId)` emits `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` and sets the metadata `agentWallet` to `msg.sender`.
  - `setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)` may be called by the owner or an approved operator. `signature` is the **new wallet's** EIP-712 signature over `AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)`. The domain is `{name: "ERC8004IdentityRegistry", version: "1", chainId: 5042002, verifyingContract: <proxy>}`. The deadline must be no later than `block.timestamp + 5 minutes`.
  - `getAgentWallet(uint256 agentId) view returns (address)`, `setApprovalForAll(address operator, bool approved)`, `ownerOf(uint256)` and `tokenURI(uint256)`.
- ReputationRegistry proxy: `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
  - `giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)`. The client is `msg.sender`; there is no feedback-auth step.
  - It emits `NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)`.
- ValidationRegistry proxy: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`. It is not used here.

## Lease

You may create or change only these paths:

- `packages/identity/src/**`
- `packages/identity/test/**`
- `scripts/erc8004/**`
- `contracts/test/mocks/MockIdentityRegistry.sol` and `contracts/test/mocks/MockReputationRegistry.sol` (new; mocks for tests only)
- `.packets/reports/cs-08-identity.md`

Do not edit any `package.json`, `bun.lock`, `contracts/src/**`, `apps/**`, or any other package. `packages/identity` already declares `viem` and `@countersign/core`.

## What to build

1. `packages/identity/src/abi.ts`: minimal `as const` ABIs for the functions and events above.
2. `packages/identity/src/registration.ts`:
   - `registrationFile({name, description, hubUrl, seller, offers})` returns the ERC-8004 registration JSON:
     - `type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"`, `name` and `description`;
     - `endpoints: [{name: "A2A", endpoint: hubUrl + "/.well-known/agent-card.json"}, {name: "agentWallet", endpoint: "eip155:5042002:" + seller}]`;
     - `supportedTrust: ["reputation"]`;
     - `offers`: offer hashes only.
   - `toDataUri(json)` returns `data:application/json;base64,<base64>`. Use `btoa` over the UTF-8 bytes, as in `packages/core/src/wire.ts`.
3. `packages/identity/src/erc8004.ts`. Every function takes viem clients; nothing reads env.
   - `ARC_TESTNET_REGISTRIES = {identity, reputation, validation}`, holding the addresses above.
   - `registerAgent(wallet, publicClient, registry, agentURI) => {agentId: bigint, tx: Hex}`. Parse `agentId` from the `Registered` log in the receipt.
   - `grantOperator(wallet, publicClient, registry, operator) => tx`, which calls `setApprovalForAll(operator, true)`.
   - `agentWalletTypedData(registry, chainId, agentId, newWallet, owner, deadline)` returns the typed data to sign.
   - `bindAgentWallet({wallet, publicClient, registry, chainId, agentId, newWalletAccount, deadline}) => tx`:
     - `newWalletAccount` signs `agentWalletTypedData(...)`;
     - `wallet`, the owner or an operator, sends `setAgentWallet`.
   - `feedbackFromSlip(slip: Slip, hubUrl: string)` returns `{value: 100n for a slip with escrow (released), valueDecimals: 0, tag1: "countersign", tag2: slip.body.rail, endpoint: hubUrl + "/offers/" + slip.body.offerHash + "/call", feedbackURI: hubUrl + "/slips/" + slip.hash, feedbackHash: slip.hash}`.
   - `giveFeedback(wallet, publicClient, registry, agentId, fb) => tx`.
   - `readFeedback(publicClient, registry, agentId, fromBlock) => Array<{client, index, value, decimals, tag1, tag2, endpoint, feedbackURI, feedbackHash, blockNumber, tx}>`, from `NewFeedback` logs filtered by `agentId`, in windows of 10,000 blocks.
   - `earnedFeedback(feedback, releasedSlips: Array<{hash, buyer}>)` keeps only entries whose `feedbackHash` matches a released slip's hash and whose `client` equals that slip's buyer, case-insensitively.
4. `packages/identity/src/index.ts` exports all of the above.
5. Ops scripts, run by the integrator with keys from the environment only. Never print a key or accept one in argv.
   - `scripts/erc8004/register-seller.ts --hub <url> [--operator <address>]` takes the seller key from `CS_SELLER_KEY`. It registers with a data-URI registration file, grants the operator when one is given, and prints `agentId` plus the tx hashes.
   - `scripts/erc8004/feedback.ts <slip.json> --agent <agentId> --hub <url>` takes the buyer key from `CS_BUYER_KEY`. It gives feedback for that slip and prints the tx hash.
   - `scripts/erc8004/read.ts --agent <agentId> [--from <block>]` prints the feedback list, one line each.
   - All three run against `https://rpc.testnet.arc.network` and `ARC_TESTNET_REGISTRIES`.
   - **Chain-parametric.** All three also take `--rpc <url>` and `--chain-id <id>`, defaulting to Arc testnet. The same registries are deployed at the same addresses on Hedera testnet (chain 296, RPC `https://testnet.hashio.io/api`), so export `HEDERA_TESTNET_REGISTRIES` beside `ARC_TESTNET_REGISTRIES`. Nothing in `packages/identity` may hard-code Arc beyond those exported constants: every function gets its chain through its clients and an explicit `chainId`.

## Tests (anvil only, never a public RPC)

- `contracts/test/mocks/MockIdentityRegistry.sol` is a minimal ERC-721 using OpenZeppelin `ERC721` and `EIP712`, with the same functions and events and the same EIP-712 check in `setAgentWallet`. The EIP712 name is `"ERC8004IdentityRegistry"`, version `"1"`.
- `contracts/test/mocks/MockReputationRegistry.sol` has `giveFeedback`, which emits `NewFeedback` with an incrementing index per (agentId, client).
- `packages/identity/test/erc8004.test.ts`, following the anvil pattern in `packages/rail/test/escrow.test.ts`:
  1. Run `forge build`, start anvil on a random port, and deploy both mocks from `contracts/out`.
  2. Register and check that the returned `agentId` matches `ownerOf`.
  3. Grant the operator. The operator then binds a new wallet using the new wallet's signature, and `getAgentWallet` returns it.
  4. A wrong signer is refused.
  5. Give feedback built with `feedbackFromSlip`, then read it back.
  6. `earnedFeedback` keeps a matching slip and drops one with a different client or an unknown hash.
- `packages/identity/test/registration.test.ts`: the data URI round-trips back to JSON, and has the endpoints and the type.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code: nothing under `apps/web`.
- Never call a faucet or a public RPC in tests. Never use a private key except the fixed anvil test keys.
- TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/identity && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit on your branch with small present-tense messages ending `(refs #2)`, and no trailers. Write `.packets/reports/cs-08-identity.md`. Do not push, merge or deploy.
