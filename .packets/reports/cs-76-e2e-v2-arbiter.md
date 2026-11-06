# cs-76-e2e-v2-arbiter report

Lane: cs-e2e. Branch: `cs/cs-76`. Commit: `7b08110` (feature, tests and docs).

## Changes

### `e2e/lib/chains.ts`

- line 219: `ARBITER`, the ABI fragment `function arbiter() view returns (address)`.
- lines 279-283: `arcArbiter()` reads `arbiter()` from `ARC.escrow` on v2 and returns null on v1.
- lines 285-292: `arbiterReason(version, arbiter, submitter)` returns null on v1 or when the
  arbiter is the submitter, compared case-insensitively; otherwise it returns
  `escrow v2 releases only from its arbiter <arbiter>, and this suite's hub signs as <submitter>`.

### `e2e/lib/actors.ts`

- line 9: imports `privateKeyToAccount` from `viem/accounts`.
- lines 186-189: `submitterAddress(ctx)` derives and returns only the address of
  `E2E_ARC_SUBMITTER_KEY`; the key is not logged.

### Flows

Each flow makes the check the first thing in `run`, before `startHub` and before any funding:

- `e2e/flows/arc-spine.flow.ts`: imports at lines 11, 13 and 14; guard at lines 39-40.
- `e2e/flows/arc-deadline-refund.flow.ts`: imports at lines 9, 11 and 12; guard at lines 40-41.
- `e2e/flows/ratings.flow.ts`: imports at lines 10, 12 and 13; guard at lines 66-67.

The guard is:

```ts
const blocked = arbiterReason(ARC.escrowVersion, await arcArbiter(), submitterAddress(ctx));
if (blocked) throw new NotRun(blocked);
```

On v1 it is a no-op because `arcArbiter()` returns null and `arbiterReason` returns null.
`slip-onchain-arc` reports NOT RUN through its existing `needs: ["arc-spine"]`.

### Tests

`e2e/test/escrow-v2.test.ts`:

- line 12: imports `arbiterReason`.
- lines 92-110: three offline cases: v1 returns null; v2 with the same address in different
  case returns null (both directions); v2 with a different address returns the exact message
  naming both addresses.

### Docs

`docs/e2e.md` line 65: one paragraph in "Escrow version": v2 releases only from its arbiter,
the Arc v2 arbiter is the production hub, and a local-hub run therefore reports `arc-spine`,
`arc-deadline-refund` and `ratings` as NOT RUN, naming both addresses.

## Gate

### 1. Install and typecheck

```text
$ bun install --linker hoisted

bun install v1.3.14 (0d9b296a)

13 packages installed [1131.00ms]
```

```text
$ bun run typecheck
$ tsc -p tsconfig.json
```

Exit code 0; no diagnostics.

### 2. `bun test e2e/test`

```text
bun test v1.3.14 (0d9b296a)

 40 pass
 0 fail
 114 expect() calls
Ran 40 tests across 2 files. [8.37s]
```

### 2b. `bun test e2e/human/test`

```text
bun test v1.3.14 (0d9b296a)

 54 pass
 0 fail
 166 expect() calls
Ran 54 tests across 9 files. [2.01s]
```

### 3. `bun run e2e -- --list`

All 27 flows are listed:

```text
$ bun run --cwd e2e start --list
$ bun run.ts --list
1   arc-spine                orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.02 USDC gas
1b  runner-restart           orch-cs  none       
2   arc-wrong-amount         orch-cs  arc        Arc stranger 0.01 USDC gas
3   arc-deadline-refund      orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
4a  slip-onchain-arc         orch-cs  arc        needs arc-spine  
10  arc-gateway              orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.01 USDC
11  refusals                 orch-cs  none       
13  ratings                  orch-cs  arc        Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
5   whitechain               cs-wc    whitechain Whitechain buyer 0.01 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.01 USDT
4b  slip-onchain-whitechain  cs-wc    whitechain needs whitechain  
6   hedera                   cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
7   merchant                 cs-wc    whitechain Whitechain buyer 0.02 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.005 USDT
8   discovery                orch-cs  none       
12  public-spine             orch-cs  arc        Arc buyer 0.05 USDC
15  public-hedera            cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        NOT RUN (retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed)  Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     NOT RUN (retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed. Its Agent Kit offer is paid held in flow 21)  Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
18  erc8004-identity         cs-hd    hedera     
18b erc8004-arc              orch-cs  arc        
19  mpp                      cs-hd    tempo      MPP payer 0.03 pathUSD
20  hedera-schedule          cs-hd    hedera     NOT RUN (on demand: about 0.18 HBAR a run; run it with --flow hedera-schedule)  Hedera agent 0.01 USDC, Hedera agent 0.2 HBAR
21  hedera-held              cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR a run; run it with --flow hedera-held)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
21b hedera-held-undelivered  cs-hd    hedera     NOT RUN (on demand: about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered)  Hedera agent 0.05 USDC, Hedera agent 0.17 HBAR
14a production-console       cs-ui    none       
14b production-hub           orch-cs  none       
14c production-approvals     cs-ui    none       
9   web                      cs-ui    none       NOT RUN (cut: screenshot rounds cover it)  
```

## Notes

- No flow was run; only `--list`. No browser was used.
- No key was read, printed or written.
- The pre-existing mode change on `packages/cli/src/bin.ts` was left unstaged and untouched.
