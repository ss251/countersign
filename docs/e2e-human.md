# The human end-to-end run

`e2e/human` is a Playwright project that does what a person does on the deployed console and hub, and proves each money step on chain. It is separate from the fast suite in `e2e/` ([e2e.md](e2e.md)) and has its own report. [D14, amended](decisions.md) is why it exists. Its first green run against production is [`20261106-192916-e0f5`](../e2e/human/runs/20261106-192916-e0f5.md), the `privy` project, 9 of 9 steps. Its row in [status.md](status.md) stays `IN PROGRESS` until that run's test code is on `main` and the nightly run is green.

## What one run does

| Step | What it checks |
|---|---|
| 00 open | The console loads. |
| 01 sign-in | The person signs in: through the Privy modal, or with the injected test wallet (below). |
| 02 wallet | The wallet is on Arc testnet. |
| 03 fund | The wallet receives 1 USDC on Arc from a funder key. |
| 04 balance | The balance moved by exactly 1 USDC. |
| 05 buy | The person buys an Arc escrow offer: countersign, then fund. |
| 06 prove | The purchase is on chain: the seller delivers and the escrow releases. |
| 07 slip | The slip verifies in the console, and again with the standalone verifier (`packages/verify`). |

A run pays at most `E2E_HUMAN_MAX_PRICE` atomic USDC (default `50000`, 0.05 USDC).

Not in it yet: the merchant refund through the deployed console, which is the next flow.

## Two projects

- **`injected`.** A test wallet is generated for the run and installed as an EIP-1193 provider. Its key never enters the browser. This is the path when the console has no Privy app id, and it is the one that runs before Privy is live.
- **`privy`.** It signs in with the Privy test account (`PRIVY_TEST_EMAIL`, `PRIVY_TEST_OTP`).
  - Without those, it reports `NOT RUN`.
  - A Privy outage that fails sign-in also reports `NOT RUN`, never `FAIL`, so Privy can never turn a green build red.

## Running it

Where it runs, by the project lead's decision for this event:
- **On demand:** on the build machine, for this project only. It uses Playwright's bundled Chromium with a fresh profile per run, against only the production console and hub, and cs-e2e starts it by hand. Every other job keeps the build machine's no-browser rule.
- **In CI:** [`.github/workflows/human-e2e.yml`](../.github/workflows/human-e2e.yml) runs it nightly at 21:30 UTC, and on demand from the Actions tab with a choice of `both`, `privy` or `injected`. It never runs on pull requests.

The tests run under Node; the verifier is their one Bun call.

```sh
cd e2e
npx playwright test -c human/playwright.config.ts                     # both projects
npx playwright test -c human/playwright.config.ts --project=injected  # one project
npx playwright test -c human/playwright.config.ts --list              # list the steps; no browser
```

The project's own unit tests need no browser and no network:

```sh
bun test e2e/human/test
```

## Configuration

All optional. The defaults are the production console and hub.

| Variable | Default | Use |
|---|---|---|
| `E2E_HUMAN_CONSOLE` | the production console | console base URL |
| `E2E_HUMAN_HUB` | the production hub | hub base URL |
| `E2E_HUMAN_MAX_PRICE` | `50000` | the most a run pays, in atomic USDC |
| `E2E_ARC_RPC` | the suite's Arc RPC | Arc testnet RPC |

Secrets are read through `e2e/human/lib/keys.ts`: from the environment first, then from the files under `~/.config/countersign/`. They are never printed.

| Secret | Use |
|---|---|
| `E2E_HUMAN_FUNDER_KEY` | the funder key in CI, a dedicated test-funder topped up by the deployer |
| `CS_DEPLOYER_KEY` | the funder key for an on-demand run outside CI |
| `PRIVY_TEST_EMAIL`, `PRIVY_TEST_OTP` | the Privy test account |

Without either funder key, step 03 fails with "no funder key".

## Its report

Each run writes `e2e/human/runs/<run-id>.md` and `e2e/human/runs/LATEST.md`, never `e2e/runs/LATEST.md`.

Screenshots, the trace and the slip go under `e2e/human/artifacts/<run-id>/<project>/`. A leak scan deletes any text artifact that contains a registered secret, and makes the run exit non-zero.
