# How countersign was built

The rules ask where AI was used. This folder is the answer: the plan, the rules every session worked to, the briefs, the decisions taken during the night, the review notes and the audits. The specs are in [`docs/spec/`](../spec/), and the task packets the workers executed are in [`.packets/`](../../.packets/).

## The workflow

- **The project lead** set the goals and took the decisions. Each decision during the night is a steer, in [`steers/`](steers/).
- **Claude Opus lanes**, one per area (orchestration, Whitechain, Hedera, the console, the phone, end-to-end tests, claims, docs), planned and designed the work. They wrote each task as a packet with its acceptance test, and reviewed what came back. They also wrote the screens and the docs themselves. Their briefs are in [`lanes/`](lanes/).
- **DeepSeek workers** wrote most of the other code. Each one executed exactly one packet, in its own worktree.
- **A reviewer lane** (cs-w1) read every diff that touches money and posted blockers. Nothing merged with a blocker open, and nothing merged without a green gate: typecheck, the bun tests and forge. Its notes are in [`reviews/`](reviews/).
- **Audits** of the escrow contract are in [`audits/`](audits/) and [`../audits/`](../audits/): an audit pass on main, and an independent audit of escrow v2 by Grok 4.7.
- **The evidence** is the end-to-end suite and the chain. A claim counts only with a green flow on a real chain, a link that opens logged out, or a signed transaction ([status.md](../status.md)).
- **A human teammate** also wrote features directly, through pull requests that went through the same review and gate: seller ratings, Circle CLI interop, the guides and threat model, ENS seller names, the mainnet guard and the escrow v2 contract.

## What is here

| Path | What it is |
|---|---|
| [`PLAN.md`](PLAN.md) | The plan the build started from |
| [`COMMON.md`](COMMON.md) | The rules every session worked to, as amended during the night |
| [`lanes/`](lanes/) | Each lane's brief |
| [`steers/`](steers/) | The project lead's decisions, in time order by file name |
| [`reviews/`](reviews/) | The reviewer's notes, one file per reviewed commit |
| [`audits/`](audits/) | The escrow audit on main, and the brief given to the independent auditor |

## How these copies are made

Every file here except this one is generated from the working directory by a script, never edited by hand. The script makes four kinds of change:

- local paths become `$M` (the planning directory), `$R` (the clone), `$WT` (the worktrees) or `~`;
- machine names become "the build machine" and "the second machine";
- the person directing the work is called the project lead;
- lines about other work on the same machines are removed.

The output then has to pass a term check and gitleaks before it is committed. Each file starts with a one-line note saying so. Variable names appear; secret values never do.
