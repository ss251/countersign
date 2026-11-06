# cs-61-e2e-fixes — report

Base: `cs/e2e` at `ce1e895`. Branch: `cs/cs-61`.

Three suite-side fixes, one commit each. No flow was run, no browser or screenshot tool was
started, and no key was read or printed.

## Commits

- `42a706d` read the production slip from a settlement that has one
- `8b418f6` find the expired held entry on the topic itself
- `56127c2` wait for the mpp demo server to answer

## 1. production-hub (14b) — read a slip from a settlement that has one

File: `e2e/flows/production.flow.ts`, lines 140-150.

- The existing `/settlements?limit=1` request still supplies the agent from its first row, as the
  console does.
- A second request, `ctx.http("settlements with slips", `${hub}/settlements?limit=20`)`, must answer
  200. `slipHash` is the first non-empty `slipHash` in the hub's newest-first order.
- The existing failure "no settlement carries a slip hash to read (slip, verify)" still applies when
  none of the 20 rows has one. Every other check is unchanged.

## 2. hedera-held-undelivered (21b) — find the agent's expired entry on the topic

File: `e2e/flows/hedera-held.flow.ts`.

- Lines 288-295: `expired log` is now optional in the agent evidence. A value of the form `#<n>` is
  still used directly; otherwise the entry is found on the topic.
- Lines 144-166: `findExpired` polls
  `/api/v1/topics/${topicId}/messages?sequencenumber=gt:${logSequence}&order=asc&limit=50` every 3 s
  for up to 180 s. Each message is decoded base64 then JSON, and the first entry with
  `kind === "expired"` and `schedule === scheduleId` gives `expiredSequence`. Timeout fails with
  `no expired entry for <scheduleId> on the topic after #<logSequence>`.
- The HCS step (lines 311-324) is unchanged: `topicMessage(topicId, expiredSequence)` still requires
  kind `expired`, the schedule, the create tx and the agent as payer. The hub answer, `executed`,
  `release`, the balance, and every other check in the step still apply.

## 3. mpp (19) — wait until the demo server answers

File: `e2e/flows/mpp.flow.ts`, lines 168-179.

- After the existing ready-line `waitFor` and `check`, the step polls
  `fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(2000) })` every 250 ms for up to 30 s,
  stopping at the first 200. A thrown fetch retries.
- Timeout fails with "the mpp demo server printed ready but did not answer within 30 s".
- `scripts/mpp/server.ts` is untouched.

## Gate

### 1. `bun run typecheck`

**Not clean, and not because of this lane.** It exits 2 with 15 errors, all outside `e2e`; `e2e`
has zero errors. A detached worktree at the base commit `ce1e895` with a fresh
`bun install --frozen-lockfile` gives the same 15 errors and exit 2, so this is pre-existing. It
cannot be fixed within the packet's constraint to touch only the three flow files.

```
apps/hub/src/buyerplumbing.ts(424,21): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
apps/hub/src/buyerplumbing.ts(427,26): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
packages/buyer/src/hedera/test/agent.test.ts(326,46): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/buyer/src/hedera/test/charged.test.ts(293,46): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/buyer/src/hedera/test/charged.test.ts(303,46): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/buyer/src/openai/server.ts(488,26): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
packages/rail/src/hedera/held.ts(210,36): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/rail/src/hedera/held.ts(353,54): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/rail/src/hedera/inspect.ts(30,32): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/rail/src/hedera/schedule.ts(210,55): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike> | Reader'.
packages/rail/src/hedera/schedule.ts(219,38): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/rail/src/hedera/test/prepare-countersign.test.ts(132,38): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
packages/relay/src/merchant-server.ts(278,26): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
packages/relay/src/paywall.ts(369,26): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
scripts/hedera/agent-run.ts(256,81): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
```

Tail:

```
  Type 'Buffer' is not assignable to type 'Uint8Array<ArrayBufferLike> | DataView<ArrayBufferLike>'.
    Type 'Buffer' is not assignable to type 'Uint8Array<ArrayBufferLike>'.
      The types of 'slice(...).buffer' are incompatible between these types.
        Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
          Property 'resize' is missing in type 'SharedArrayBuffer' but required in type 'ArrayBuffer'.
packages/relay/src/paywall.ts(369,26): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'ArrayBufferView'.
  Type 'Buffer' is not assignable to type 'Uint8Array<ArrayBufferLike> | DataView<ArrayBufferLike>'.
    Type 'Buffer' is not assignable to type 'Uint8Array<ArrayBufferLike>'.
      The types of 'slice(...).buffer' are incompatible between these types.
        Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
          Property 'resize' is missing in type 'SharedArrayBuffer' but required in type 'ArrayBuffer'.
scripts/hedera/agent-run.ts(256,81): error TS2345: Argument of type 'Buffer' is not assignable to parameter of type 'Uint8Array<ArrayBufferLike>'.
  The types of 'slice(...).buffer' are incompatible between these types.
    Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
      Property 'resize' is missing in type 'SharedArrayBuffer' but required in type 'ArrayBuffer'.
```

### 2. `bun test e2e/test`

```
bun test v1.3.14 (0d9b296a)

 21 pass
 0 fail
 66 expect() calls
Ran 21 tests across 1 file. [7.49s]
```

### 3. `bun run e2e -- --list`

```
$ bun run --cwd e2e start --list
$ bun run.ts --list
1   arc-spine                orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.02 USDC gas
1b  runner-restart           orch-cs  none       
2   arc-wrong-amount         orch-cs  arc        Arc stranger 0.01 USDC gas
3   arc-deadline-refund      orch-cs  arc        Arc buyer 0.01 USDC, Arc hub gas wallet 0.01 USDC gas, Arc stranger 0.01 USDC gas
4a  slip-onchain-arc         orch-cs  arc        needs arc-spine  
10  arc-gateway              orch-cs  arc        Arc buyer's Gateway balance 0.01 USDC
11  refusals                 orch-cs  none       
13  ratings                  orch-cs  arc        Arc buyer 0.02 USDC, Arc e2e seller 0.01 USDC, Arc hub gas wallet 0.03 USDC gas
5   whitechain               cs-wc    whitechain Whitechain buyer 0.01 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.01 USDT
4b  slip-onchain-whitechain  cs-wc    whitechain needs whitechain  
6   hedera                   cs-hd    hedera     Hedera agent 0.01 USDC, Hedera agent 0.01 HBAR
7   merchant                 cs-wc    whitechain Whitechain buyer 0.02 USDT, Whitechain relayer 0.004 WBT, Whitechain merchant 0.005 USDT
8   discovery                orch-cs  none       
12  public-spine             orch-cs  arc        Arc buyer 0.05 USDC
15  public-hedera            cs-hd    hedera     Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
16  public-gateway           orch-cs  arc        Arc buyer's Gateway balance 0.05 USDC
17  hedera-mcp               cs-hd    hedera     Hedera agent 0.05 USDC, Hedera agent 0.01 HBAR
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

## Deviations

None from the three requested changes. The only gate that does not pass is the pre-existing
typecheck failure described above; no out-of-scope file was changed to work around it.
