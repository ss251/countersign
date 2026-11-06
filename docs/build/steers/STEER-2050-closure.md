> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2050: the new clock, the PR queue, and the closure list

From the project lead at 20:45 and 20:50 IST. This replaces the 22:00 freeze (STEER-1940) and the 23:00 recording (STEER-1955). Every other standing rule holds.

## The clock

| When | What |
|---|---|
| until 04:00 IST | We build. |
| 00:00 | A checkpoint, not a freeze. |
| 04:00–06:00 | We record. |
| 06:00–08:30 | We submit. |
| 09:00 | The deadline. |

Reports go to the project lead at these times:

- **22:00:** one line per pull request: merged, green awaiting merge, or blocked with the exact reason.
- **22:30, 23:30 and 01:00:** one line per closure-list item: green, blocked and why, or not started.

Post each owner's state as a RUN-STATE line 10 minutes before each report time.

## First: clear the PR queue (project lead 20:50, act now)

We orchestrate the packets and review the diffs. Nobody on Opus writes these fixes; DeepSeek packets write them.

### 1. PR #164: Rajdeep's escrow v2, the contract half of #98

This is the critical path.

- **Review.** The reviewer goes on it before anything else. cs-w1 has already cleared 9240aec with 0 blockers. Its one should-fix, the minDuration floor, is done runner-side on cs/int.
- **CI.** The failure was not Rajdeep's code: forge-std failed to download with an HTTP 5xx at install. The project lead re-ran the gate.
- **Landing.** orch-cs lands it once all three of these hold:
  - the gate is green;
  - the project lead has answered the forced-default call (orch-cs's option (d) is a one-line change in `fund`, made before the merge so the re-audit covers it);
  - the project lead has re-run the audit, or has said cs-w1's review is enough.

### 2. PR #97: Rajdeep's #29, mainnet fails closed

It is red on two real tests. orch-cs launches ONE DeepSeek packet on the next free slot. The packet does these steps in order.

**Step (a): update the rail switch list.**
- The test `apps/hub/test/network.test.ts:59` ("the guard knows every rail switch railsFromEnv reads") finds four variables that are not listed. They include `ARC_ESCROW_VERSION` and `HEDERA_SCHEDULED_RAIL`; the CI log has the other two.
- List each one with its correct classification, as a switch or as config.
- `HEDERA_SCHEDULED_RAIL` maps to `'hedera-scheduled'`: testnet only, with no mainnet entry and no secrets, like `HEDERA_RAIL` (orch-cs ack, 15:07Z).
- Add a test that the held rail still starts from the env.

**Step (b): diagnose the two ERC-8004 anvil tests.**
- The tests are "feedback built from a released slip is readable" and "only feedback from the slip's buyer with the slip's hash is earned". Each receives 0 entries where it expects 1.
- First, run them on main 0e53253 alone. Main's own CI at 0e53253 never got past install because of the same forge-std flake (the firstmate re-ran it at about 15:22Z), so the break may be on main from promotion #158 rather than in #97.
- Find the root cause, fix the code, and say what it was in the PR.

**Hard rule from the project lead.** The worker must not rewrite, weaken, skip, or delete these tests to make them pass. It fixes the code, or it stops and reports the root cause. If a test asserts something genuinely wrong, that is a NEEDS-PROJECT-LEAD line with the evidence, not an edit.

**Review of the diff.** cs-w1 reviews it. The firstmate also reads the diff for any change under `test/` before the merge.

### 3. PR #165: cs-hd's held-slip verifier, #163, which gates item 4

- The project lead re-ran CI in case it was the same flake.
- If it is green, orch-cs merges it.
- If it is red on a real test, cs-hd fixes it with a DeepSeek packet, under the same no-test-rewrite rule.

### 4. ENS and OpenAI are already on main and deployed

- **ENS:** Rajdeep's #91 landed as #148 inside promotion #149 (2ee66cc), and the hub deployed at 14:41Z. #91 is closed as superseded. cs-readme confirms that #91 carries a comment pointing at #148 and #149, and adds one if it does not.
- **OpenAI endpoint:** #156 landed in promotion #158 (0e53253, merged 15:12Z), and the hub deployed as 80f67ebe.
- Both rows in status.md flip to SHIPPED with that evidence (cs-readme).

### 5. PR #100, the threat model and guides

The project lead squash-merged it as 39114c8. Its status.md row flips (cs-readme).

### Main's CI

The firstmate re-ran the gate on main 0e53253. orch-cs confirms that it is green, or posts exactly what is red.

## The closure list (project lead 20:45)

Nothing on this list is silently dropped. A lane that finishes early takes the next item from this list, never a new idea.

| Item | The project lead's words | Owner | Deadline |
|---|---|---|---|
| **Contract** | One v2 contract with the four audit fixes, accept, dispute, releaseAfterWindow, bond from the offer inside the countersigned jobId, deadline default paying the bond to the buyer; six tests plus the audit re-run; then deploy Arc and Whitechain and show one bonded fail-delivery transaction | Rajdeep (the contract); orch-cs (landing #164, the Arc deploy through Studio or forge, the bonded failDelivery job, the production switch if the project lead picks it); cs-wc (the 1874 deploy per `$M/wc/DEPLOY-1874-v2.md`); cs-phone (the v2 entry in `KNOWN_ESCROWS`) | 23:30 |
| **Hedera** | Scheduled checkout becomes the default path so a failed delivery moves nothing, and the e2e hedera flow goes green | cs-hd (#165, then `HEDERA_SCHEDULED_RAIL=1` on production and the Agent Kit offer listing `hedera-scheduled` first); cs-e2e (flows 21 and 21b on production, then LATEST.md) | 23:30 |
| **Hub** | Direct-rail honesty plus /trees/:root and the tree view, cycle refusal on lineage, delisting with a canary, and an openapi adapter | split below | 23:00 |
| **Console** | HUMAN_APPROVAL_TOKEN on production and the phone signing version 2 decisions, then the landing deploy from PR 136 | cs-ui | 23:30 |
| **Merge queue** | PR 91 ENS, PR 97 mainnet fails closed, PR 100 the docs pack, and the OpenAI endpoint branch | orch-cs (merges); cs-w1 (reviews) | 22:30 |
| **Stretch** | Only after all of that is green: private payloads with X25519 and docs/privacy.md | cs-truth, from `$M/privacy/DESIGN.md` | after the list is green |

The console item is live already:

- the token has been active since 14:41Z;
- v2 decisions were proven end to end at 14:48Z;
- the landing is deployed.

cs-ui re-checks all three on production and posts DONE with the evidence. status.md still says IN PROGRESS for the approvals and buyer-phone rows, so cs-readme flips them.

### The hub lane split (23:00)

Every item below is NOT BUILT on main. Use one DeepSeek packet per item, with the acceptance written in the packet.

| Item | Owner | Acceptance (keep to the project lead's words; no widening) |
|---|---|---|
| Cycle refusal on lineage (#27) | cs-truth writes the packet | A call whose lineage already contains the seller or offer it is about to buy is refused before payment, with a 4xx and no 402. There is a test, and the status row flips. |
| Delisting with a canary (#26) | cs-truth writes the packet | There is a delist route. A canary call to each live offer delists an offer that fails it, and a delisted offer is not served or sold. There is a test, and the status row flips. |
| /trees/:root and the tree view (#18) | cs-ui (the hub route and the console view) | `GET /trees/:root` returns the receipt tree from real slips, and the console's slip view draws it from that route, not from sample data. There is a test, and the status row flips. |
| The openapi adapter | cs-phone | The runner serves an offer backed by an OpenAPI operation, as the skill and mcp adapters do. There is a test with a local spec, and the status row flips. |
| Direct-rail honesty | cs-ui (console copy), with cs-readme (docs, terms.md §4) | Before payment, no surface promises a refund on a direct rail. The offer page and the assistant say which rails return money on a failed delivery (escrow, held Hedera) and which do not. A test fails if the old promise comes back. |

#18 and #27 were Rajdeep's, and neither has a branch. The fleet takes them now per the closure list. orch-cs posts on both issues: "the fleet is building this for tonight's closure list; if you have local work, push it and we build on it". The firstmate tells the project lead.

## Slots and review order

The writer cap stays 5 until the project lead says otherwise; the firstmate has asked to raise it to 8 for the hub lane.

Slots and cs-w1's reviews go in this order:

1. #164
2. the #97 packet
3. #165 and any corrective it needs
4. the hub lane, in this order:
   1. #27
   2. #26
   3. #18
   4. openapi
   5. honesty
5. the contract deploys and the bonded job
6. the Hedera switch and flows
7. the stretch

Before a launch, check load: wait if the first number is above 24.

## Decisions waiting on the project lead

The firstmate has relayed each of these. Do not act on any of them before the answer arrives.

1. **The forced default:** option (d), bonded jobs fund only through the arbiter. It is recommended.
2. **The re-audit of #164:** whether it is still a gate, or whether cs-w1's review is enough.
3. **Production on v2:** the firstmate recommends (a), now that the recording is at 04:00. Option (b) stays the fallback.
4. **The writer cap:** 5 to 8.
