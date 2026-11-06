# The human acceptance run

A Playwright project that does what a person does on the deployed console and hub, and proves each
money step on chain: sign in, fund the wallet with 1 USDC, buy an Arc escrow offer (countersign,
read the review, sign, fund), watch the seller deliver and release, then verify the slip in the
console and with the standalone verifier. The review's payee, amount and job are checked against
the slip and the `Funded` log.

## Run

```
cd e2e
npx playwright test -c human/playwright.config.ts            # both projects
npx playwright test -c human/playwright.config.ts --project=injected
npx playwright test -c human/playwright.config.ts --list     # no browser
```

The tests run under Node, not Bun. The verifier child process is the one Bun call.

Two projects:

- `injected` installs a test wallet generated for the run; its key never enters the browser.
- `privy` signs in with the test account through the Privy modal.

Each run writes `runs/<run-id>.md` and `runs/LATEST.md`; screenshots, the trace and the slip go
under `artifacts/<run-id>/<project>/`. The leak scan deletes any text artifact that holds a
registered secret and makes the run exit non-zero.

## Environment

All optional. Defaults are the production console and hub.

| var | default | use |
|---|---|---|
| `E2E_HUMAN_CONSOLE` | production console | console base URL |
| `E2E_HUMAN_HUB` | production hub | hub base URL |
| `E2E_HUMAN_MAX_PRICE` | `50000` | the most a run pays, atomic USDC |
| `E2E_ARC_RPC` | the suite's Arc RPC | Arc testnet RPC |

Secrets are read through `lib/keys.ts`: `process.env` first, then the files under
`~/.config/countersign/` (including `privy.env`).

| name | use |
|---|---|
| `E2E_HUMAN_FUNDER_KEY` | the funder key in CI |
| `CS_DEPLOYER_KEY` | the funder key on devcube |
| `PRIVY_TEST_EMAIL` | the Privy test account |
| `PRIVY_TEST_OTP` | its one-time code |

Without either funder key the funding step fails with "no funder key". Without the Privy login the
`privy` project reports NOT RUN. A Privy outage that fails sign-in also reports NOT RUN, never FAIL.

## Offline tests

```
bun test e2e/human/test
```

They cover the injected wallet's request handler, the secrets loader, the report renderer and leak
scan, the funding arithmetic and the review values' parsing. No browser and no network.
