# tr-06: the erc8183 rail, countersign's escrow over Arc's ERC-8183 core, with a JobHook that emits the slip hash (refs #24)

**Design: decided.** cs-truth wrote this on Opus from the project lead's STEER-2235 item 1 and `docs/decisions.md` D21, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose. Never edit `contracts/src/CountersignedEscrow.sol` or `contracts/src/ICountersignedEscrow.sol`: another person owns them tonight.

## Goal

A new rail `erc8183` settles like the Arc escrow, but its money sits in an ERC-8183 job on Arc's shared `AgenticCommerce` core. At release a JobHook emits the slip hash. A test proves that a settle emits the hook.

## Facts you build against (read on chain on 06 Nov; do not re-derive)

- **The core.** `AgenticCommerce` on Arc testnet is at `0x0747EEf0706327138c69792bF28Cd525089e4583`. It pays in USDC `0x3600000000000000000000000000000000000000`, and its fees are 0.
- **Its functions** (the ERC-8183 reference):
  ```solidity
  enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }
  struct Job { uint256 id; address client; address provider; address evaluator; string description; uint256 budget; uint256 expiredAt; JobStatus status; address hook; }
  function createJob(address provider, address evaluator, uint256 expiredAt, string calldata description, address hook) external returns (uint256);
  function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;   // provider only, Open only
  function fund(uint256 jobId, bytes calldata optParams) external;                       // client only; pulls budget with transferFrom(client)
  function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external; // provider only, Funded
  function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;   // evaluator only, Submitted; pays the provider
  function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;     // evaluator if Funded or Submitted; refunds the client in full
  function claimRefund(uint256 jobId) external;                                          // anyone, once block.timestamp >= expiredAt; refunds the client
  function getJob(uint256 jobId) external view returns (Job memory);
  ```
  `createJob` reverts when `expiredAt <= block.timestamp + 5 minutes`.
- **The hook interface:**
  ```solidity
  interface IACPHook /* is IERC165 */ {
      function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
      function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
  }
  ```

## Decisions

### 1. `contracts/src/IAgenticCommerce.sol` (new)

The `JobStatus` enum, the `Job` struct and the eight functions above, as `interface IAgenticCommerce`. In the same file, `interface IACPHook is IERC165` with the two functions above.

### 2. `contracts/src/JobHook.sol` (new)

`contract JobHook is IACPHook, ERC165`:
- `event SlipCommitted(uint256 indexed job, bytes32 indexed slipHash, address indexed caller);`
- `beforeAction` does nothing.
- `afterAction(jobId, selector, data)`: when `selector == IAgenticCommerce.submit.selector`, decode `(address /*submitter*/, bytes32 deliverable, bytes memory /*optParams*/)` from `data` and `emit SlipCommitted(jobId, deliverable, msg.sender)`. Any other selector does nothing.
- `supportsInterface` returns true for `type(IACPHook).interfaceId` and ERC-165.
- No access control: the event names its caller.

### 3. `contracts/src/CountersignedEscrow8183.sol` (new)

Solidity 0.8.28, `EIP712("Countersign", "1")` and `ReentrancyGuard`, with `SafeERC20` and `SignatureChecker` from OpenZeppelin 5.6.1.

**Mirror v1.** Reproduce v1's checks and digests exactly as `contracts/src/CountersignedEscrow.sol` has them at commit `f2bb283`; read it with `git show f2bb283:contracts/src/CountersignedEscrow.sol`. That covers:
- `COUNTERSIGN_TYPEHASH`, `RELEASE_TYPEHASH`, `CANCEL_TYPEHASH` and `RECEIVE_WITH_AUTHORIZATION_TYPEHASH`;
- the `jobId` derivation;
- the pre-check that the buyer signed the token's `ReceiveWithAuthorization` (which gives `CountersignatureMismatch`), and the `receiveWithAuthorization` pull;
- the payee's `Release` and `Cancel` signatures;
- the deadline rules;
- `toll = amount * tollBps / 10_000`.

**The external ABI must equal v1's** as in `packages/rail/src/escrow/abi.ts`, so the existing rail drives it unchanged:
- `fund(bytes32 offerHash, Countersignature cs) returns (bytes32 jobId)`, where `Countersignature` is `(address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)`.
- `release(bytes32 jobId, bytes32 slipHash, bytes sellerSig)`, `refund(bytes32 jobId)` and `cancel(bytes32 jobId, bytes sellerSig)`.
- `jobOf(bytes32 jobId) returns (Job)`, with v1's struct `(address buyer, uint64 deadline, Status status, address payee, uint256 amount, bytes32 offerHash, bytes32 slipHash)` and `enum Status { None, Funded, Released, Refunded }`.
- `tollBps()`, plus v1's events `Funded`, `Released` and `Refunded` with identical signatures, and v1's custom errors under identical names.

**Added state:**
- immutables `token`, `core` (`IAgenticCommerce`), `hook` (`IACPHook`), `treasury` and `tollBps` (at most 1,000);
- `mapping(bytes32 => uint256) public job8183Of`;
- `error CoreFeeTaken(uint256 received, uint256 expected);`.

**The constructor** takes `(address token_, address core_, address hook_, address treasury_, uint16 tollBps_)`. It reverts `ZeroAddress` on any zero address and `TollTooHigh` above 1,000.

**`fund`.** v1's checks and pull, then:
1. `token.forceApprove(address(core), amount)`.
2. `uint256 expiredAt = deadline > block.timestamp + 6 minutes ? deadline : block.timestamp + 6 minutes;`
3. `uint256 id = core.createJob(address(this), address(this), expiredAt, string.concat("countersign:", Strings.toHexString(uint256(offerHash), 32)), address(0));`
4. `core.setBudget(id, amount, "")`, then `core.fund(id, "")`.
5. Store `job8183Of[jobId] = id` and the v1 `Job` with status `Funded`, then emit `Funded(...)` as v1 does.

**`release`.** v1's checks: status `Funded`, `block.timestamp <= deadline`, a non-zero `slipHash`, and the payee's `Release(jobId, slipHash)` signature. Then:
1. `core.submit(id, slipHash, "")`.
2. `uint256 before = token.balanceOf(address(this));`, then `core.complete(id, slipHash, "")`, then `uint256 received = token.balanceOf(address(this)) - before;`. If `received != amount`, revert `CoreFeeTaken(received, amount)`.
3. `hook.afterAction(id, IAgenticCommerce.submit.selector, abi.encode(address(this), slipHash, bytes("")))`.
4. Set status `Released` and store `slipHash`.
5. Transfer `amount - toll` to the payee and `toll` to the treasury, then emit `Released(jobId, slipHash, payee, paid, toll)`.

**`refund`.** Anyone may call it. Status must be `Funded` and `block.timestamp > deadline`, with v1's errors. Then:
1. `try core.reject(id, bytes32("deadline"), "") {} catch { core.claimRefund(id); }`
2. Check that the balance rose by exactly `amount`; if not, revert `CoreFeeTaken`.
3. Set status `Refunded`, transfer `amount` to the buyer, and emit `Refunded(jobId, buyer, amount, false)`.

**`cancel`.** v1's payee check: `msg.sender == payee`, or a valid `Cancel(jobId)` signature. Status must be `Funded`. Then:
1. `core.reject(id, bytes32("cancel"), "")`.
2. The same balance check as `refund`.
3. Set status `Refunded`, transfer to the buyer, and emit `Refunded(jobId, buyer, amount, true)`.

All mutating functions are `nonReentrant`.

### 4. The deploy script `contracts/script/DeployEscrow8183.s.sol` (new; do not run it)

- **Inputs.** `CS_DEPLOYER_KEY` through `vm.envUint`. Constants: `CORE = 0x0747EEf0706327138c69792bF28Cd525089e4583` and `USDC = 0x3600000000000000000000000000000000000000`.
- **Configuration.** `TREASURY = vm.envAddress("ESCROW8183_TREASURY")` and `TOLL = uint16(vm.envOr("ESCROW_TOLL_BPS", uint256(100)))`.
- **Order.** Deploy `JobHook`, then `CountersignedEscrow8183(USDC, CORE, hook, TREASURY, TOLL)`, and `console.log` both addresses.

### 5. TypeScript

- **`packages/rail/src/escrow/index.ts`.** `EscrowRailConfig.id` becomes `"escrow" | "whitechain" | "erc8183"`. Nothing else changes.
- **`apps/hub/src/rails.ts`.** When `ERC8183_ESCROW` is set together with `ARC_RPC_URL`, add `escrowRail({ ...the exact config the "escrow" rail gets, id: "erc8183", escrow: env.ERC8183_ESCROW, version: 1 })`.
  - Add `ERC8183_ESCROW` everywhere `ARC_ESCROW` is listed: the rail switch list (`{ id: "erc8183", vars: ["ERC8183_ESCROW"], requested: (env) => Boolean(env.ERC8183_ESCROW) }`) and any guard or classification list. Classify it exactly as `ARC_ESCROW` is classified.
  - `apps/hub/test/network.test.ts` and `apps/hub/test/rails-switches.test.ts` must then pass unedited.
- **`packages/core/src/types.ts`.** Change the `erc8183` line of the `RAIL_IDS` comment to ` * - erc8183:    countersign's escrow holding its money in an ERC-8183 job on Arc's shared core; a JobHook emits the slip hash (D21)`.

## Lease

- new: `contracts/src/IAgenticCommerce.sol`, `contracts/src/JobHook.sol`, `contracts/src/CountersignedEscrow8183.sol`, `contracts/script/DeployEscrow8183.s.sol`, `contracts/test/CountersignedEscrow8183.t.sol`, `contracts/test/mocks/MockAgenticCommerce.sol`, `apps/hub/test/rails-erc8183.test.ts`;
- `packages/rail/src/escrow/index.ts` (the id union only);
- `apps/hub/src/rails.ts`, and the file that holds the rail guard or classification list if it is another file (`ERC8183_ESCROW` only);
- `packages/core/src/types.ts` (that one comment line).

Read only: everything else. Never touch `CountersignedEscrow.sol` or `ICountersignedEscrow.sol`. Never commit `bun.lock`.

## Tests (no network, no fork)

**`contracts/test/mocks/MockAgenticCommerce.sol`.** A faithful in-memory core:
- the eight functions with the role and status rules listed above, including `ExpiryTooShort` (`expiredAt <= block.timestamp + 5 minutes`);
- `fund` pulls the budget with `transferFrom(client)`, and `complete` pays `budget - skim` to the provider;
- `reject` and `claimRefund` pay the client the full budget;
- a public `uint256 skimBps` setter, default 0, to simulate a fee;
- a public `bool rejectReverts` setter, default false. When it is true, `reject` reverts, to simulate a core that refuses a late reject.

Use `contracts/test/mocks/MockEIP3009.sol` as USDC.

**`contracts/test/CountersignedEscrow8183.t.sol`:**
1. **Fund.** It emits `Funded`. The core's job has `client == provider == evaluator == escrow`, `budget == amount` and status `Funded`, and the escrow holds no tokens afterwards.
2. **A settle emits the hook (the project lead's test).** `release` emits `JobHook.SlipCommitted(job8183Of[jobId], slipHash, address(escrow))` and `Released(jobId, slipHash, payee, paid, toll)`, with `paid + toll == amount`. The payee and treasury balances rise by exactly those, and the core's job is `Completed`.
3. **Moved price.** `fund` with the buyer's signature for another amount reverts `CountersignatureMismatch`.
4. **Replay.** A second `fund` with the same countersignature reverts.
5. **Deadline refund.** `refund` before the deadline reverts as v1 does. After it, a stranger's `refund` emits `Refunded(jobId, buyer, amount, false)`, and the buyer gets the full amount.
6. **The `claimRefund` fallback.** Set `rejectReverts = true` and warp past the core job's `expiredAt`. `refund` still returns the full amount to the buyer through `claimRefund`, and emits `Refunded(jobId, buyer, amount, false)`.
7. **Cancel.** The payee's `Cancel` signature emits `Refunded(jobId, buyer, amount, true)`.
8. **Release rules.** A release after the deadline reverts as v1 does, and a second release reverts.
9. **A fee appears.** Set `skimBps = 100`. `release` reverts `CoreFeeTaken`, and after the deadline `refund` returns the full amount.
10. **Short deadline.** An offer deadline of 60 seconds still funds, with the core's `expiredAt` at least now plus 6 minutes, and releases before the deadline.
11. **The JobHook alone.**
    - `afterAction` with the `submit` selector emits `SlipCommitted` naming `msg.sender`.
    - Any other selector emits nothing, and `beforeAction` does nothing.
    - `supportsInterface(type(IACPHook).interfaceId)` is true.

**`apps/hub/test/rails-erc8183.test.ts`.**
- With `ERC8183_ESCROW`, `ARC_RPC_URL` and `CS_RELAYER_KEY` set to test values, `railsFromEnv` declares a rail `erc8183`: network `eip155:5042002`, kind `escrow`, scheme `countersign`, and that escrow address.
- Without `ERC8183_ESCROW`, there is no `erc8183` rail.

Every existing test still passes, unedited: all 47 forge tests, `network.test.ts` and `rails-switches.test.ts` included.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests, and no `forge script --broadcast`. Never deploy.
- **Never run `git stash`.** Every worktree of a clone shares one stash stack. Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #24`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `packages/rail/src/escrow/abi.ts`'s v1 `fund`, `jobOf` or event shapes differ from what this packet names;
- `escrowRail` cannot take `version: 1` with id `erc8183`;
- a failure survives three different fixes;
- 75 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-06-erc8183-rail.md` (on the second machine): the diff summary, the test names, and the gate output counts.
