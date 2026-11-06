# Mainnet runbook

countersign runs on testnets only. A mainnet profile exists in `apps/hub/src/network.ts`, and every value in it is **pending**. While anything a mainnet hub would use is pending, the hub refuses to boot. This page covers what the guard does and the steps that clear each pending value.

## The guard

The hub reads `CS_NETWORK` before it opens its database or starts any rail.

| `CS_NETWORK` | What happens |
|---|---|
| unset, empty or `testnet` | The testnet rails boot exactly as before. A facilitator that is away at boot turns its rail off, and the hub starts with the rest. |
| `mainnet` | Every rail the environment asks for must be fully filled in the mainnet profile. Any pending value, any rail with no mainnet, or no rail at all refuses boot. |
| anything else | Refuses boot. A typo such as `Mainnet` or `prod` never means testnet. |

A refusal prints one line per reason and exits with status 1 before the hub listens:

```
$ CS_NETWORK=mainnet ARC_ESCROW=0x… ARC_RPC_URL=https://… bun apps/hub/src/index.ts
[hub] refused to boot:
[hub]   - Rail escrow chainId is pending: Arc mainnet's chain id, confirmed from Circle's Arc network page.
[hub]   - Rail escrow escrow is pending: CountersignedEscrow is not deployed on Arc mainnet. …
[hub]   - Rail escrow token is pending: …
[hub]   - Rail escrow explorerTx is pending: …
```

On mainnet the guard is stricter than testnet in three ways:

- it never boots with less than it was asked for;
- a rail switch for a testnet-only rail is a refusal, not a warning;
- even with nothing pending, it refuses until step 5 below is done, because the hub has no code that builds mainnet rails. Clearing the profile alone can never put a mainnet hub on testnet rails.

The tests are in `apps/hub/test/network.test.ts`. Two of them start the real hub process and check that it exits with status 1 and never prints `listening`.

## What is pending

| Rail | Value | Clears when |
|---|---|---|
| escrow | `chainId` | Arc mainnet's chain id is confirmed from Circle's Arc network page and matches what `eth_chainId` returns on the chosen RPC. |
| escrow | `escrow` | `CountersignedEscrow` is deployed on Arc mainnet (step 2) and its address is recorded. |
| escrow | `token` | Arc mainnet USDC is confirmed from Circle's USDC contract addresses page, and `name()` and `version()` return the EIP-712 domain the rail signs for. |
| escrow | `explorerTx` | The explorer's transaction URL is confirmed from Circle's Arc network page. |
| gateway | `network`, `facilitatorUrl` | Circle publishes a mainnet batch facilitator for Arc, and its `/supported` lists `exact` with the batched kind on that network. |
| whitechain | (none) | No mainnet: the rail and its relay are built for Whitechain Sepolia only. |
| hedera | (none) | No mainnet: network, token, mirror node and facilitators are testnet constants in `packages/rail/src/hedera/constants.ts`. |

Values in `examples/catalogue` are third-party skill content, not a source for this table. Confirm every value against the primary source named above, and record the source and the date in the commit that fills it.

## Steps to mainnet

Each step is its own pull request against `cs/int`, and none of them is done yet.

1. **Review the escrow.** Have `contracts/src` reviewed independently before it holds real funds. The README's safety limits, such as release needing only the seller's signature, stay true on mainnet. Record the review and its commit.
2. **Deploy the escrow** from the reviewed commit with `contracts/script/Deploy.s.sol`. The deployer key is set from stdin and never put in a command line. Record the address and the deploy transaction in `contracts/deployments/`.
3. **Fill the profile.** Replace each `pending(…)` in `MAINNET` with its confirmed value, one rail per pull request, naming the source of each value. Leave a rail pending rather than guess.
4. **Pin the buyer.** Add the mainnet rail to the buyer's pinned table (`packages/buyer/src/known-rails.ts`). A buyer signs only for pinned rails, so until then no buyer pays a mainnet hub, whatever the hub serves.
5. **Wire the mainnet rails.** Build mainnet rails in `railsFromEnv` from the profile, never from testnet constants. Then remove the final refusal in `assertBootable`. Every requested rail must start, or boot fails.
6. **Rehearse.** Boot a mainnet hub with one rail and the smallest price the offer allows. Run one buy, one release and one refund end to end, and check each on the explorer.
7. **Update the claims.** Change "Testnet only" in `README.md` and section 6 of `docs/terms.md` in the same pull request that first serves mainnet traffic, and no sooner.

## Rolling back

Unset `CS_NETWORK`, or set it to `testnet`, and redeploy. Jobs already funded on a mainnet escrow keep their on-chain deadlines. After its deadline, anyone can call `refund(jobId)` on the escrow, with or without a hub running. Rolling back the hub never strands funds.
