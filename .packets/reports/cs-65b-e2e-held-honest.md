# cs-65b-e2e-held-honest: the held flows assert that plain x402 Hedera is gone

Status: complete on `cs/cs-65b`. No browser was launched, no flow was run (the runner was only called
with `--list`), and no key was read or printed.

## Commit

```
30fcc2a assert the held flows' 402 offers no plain x402 Hedera
```

The report itself is the second commit on the branch.

## The change

### `e2e/flows/hedera-held.flow.ts`

Both held flows share `heldListing`, so both get these changes.

- **75-89**, step "the public hub lists the Agent Kit offer with the held rail first": the check
  `l.offer.rails.includes("hedera")` is gone. The other checks in the step are untouched: the online
  MCP offer exists, it lists `hedera-scheduled` first, its price is within `MAX_PRICE`, its canonical
  hash matches `offerHash`, and its held payee is an account.
- **91**, step renamed from "the 402 offers the held payment beside the exact one" to "the 402 offers
  the held payment and no plain x402 Hedera". Every held-accept check remains: payee, amount, asset,
  timeout, offer hash and hold length.
- **109**, the three exact-accept lines (`const exact = hederaExact(required)`, the check that it
  exists, and the payee equality) are replaced with:

  ```ts
  check(!hederaExact(required), "the 402 still offers plain x402 Hedera, which production removed by flag (captain, 23:40 IST)");
  ```

`hederaExact` remains imported because line 109 uses it.

### `docs/e2e.md`

- **232**, section "21, 21b · hedera-held", item 3: the lead now says the 402 offers the held payment
  and no plain x402 Hedera, and the closing exact-accept sentence is exactly "The 402 offers no plain
  x402 Hedera accept: production removed that rail by flag."

## Gate outputs

```
$ bun install --linker hoisted && bun run typecheck
bun install v1.3.14 (0d9b296a)

Checked 873 installs across 671 packages (no changes) [443.00ms]
$ tsc -p tsconfig.json
exit=0
```

```
$ bun test e2e/test
bun test v1.3.14 (0d9b296a)

 25 pass
 0 fail
 72 expect() calls
Ran 25 tests across 1 file. [7.46s]
exit=0
```

```
$ bun test e2e/human/test
bun test v1.3.14 (0d9b296a)

 35 pass
 0 fail
 106 expect() calls
Ran 35 tests across 9 files. [608.00ms]
exit=0
```

The human suite printed the two expected `leak:` lines from the planted-secret fixture; they are test
output, not failures, and their temporary paths are omitted here.

```
$ bun run e2e -- --list
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
exit=0
```

`hedera-held` and `hedera-held-undelivered` are listed. The Gateway flows (`10`, `16`) remain listed;
retiring them is cs-65's change, not this packet's.
