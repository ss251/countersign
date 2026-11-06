> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2108: real human end-to-end tests, with Privy and a headless browser

From the project lead at 21:05 IST.

This un-cuts the headless browser, which was CUT in D14, and adds Privy. It is also **the acceptance gate for the UI complaints** in STEER-2058: if a human cannot sign in, connect and buy without instructions, the flow is not done.

## Shape

- **Its own project.** It lives in a new `e2e/human` project, not as another flow in the existing suite, because it drives the deployed app the way a person does.
- **Scope.** The test does all of the following, against the deployed console and hub:
  1. Sign in through Privy with a test account.
  2. Get an embedded wallet and connect it.
  3. The buyer discovers an offer and countersigns it.
  4. The escrow funds on Arc from the embedded wallet.
  5. The seller delivers.
  6. The slip verifies.
  7. The merchant refunds.
- **Stack.**
  - `@privy-io/react-auth` in apps/web, with email and passkey login and an embedded wallet on Arc testnet.
  - `@privy-io/server-auth` on the hub, to verify the token.
  - Playwright in `e2e/human`, driven by `data-testid` attributes that we add as we go.
- **Funding.** The test wallet is funded before it buys. A setup step sends it 1 USDC on Arc, and the test asserts the balance.
  - **Firstmate deviation, conservative:** the money comes from a dedicated test-funder key that the deployer tops up, so the deployer's own key never sits in CI. The project lead can swap in the deployer with one secret.
- **When it runs.** On demand (`workflow_dispatch`) and nightly (`schedule`) in CI, never on pull requests.
  - Its report is separate from the fast suite: `e2e/human/runs/LATEST.md`, never `e2e/runs/LATEST.md`.
  - A Privy outage must never turn a green build red.
- **Blocked on the project lead.** We need the Privy app id, the app secret, and confirmation that test accounts are enabled. The firstmate has asked.
  - The secret goes straight into the hub's Railway variables and the repo's Actions secrets. It never goes into chat, logs, argv or a commit.
- **Until they arrive.** Build everything behind `VITE_PRIVY_APP_ID` (web) and `PRIVY_APP_ID` with `PRIVY_APP_SECRET` (hub), with a documented fallback to injected wallet connect, so the UI never ships a dead button.
  - With no app id set, there is no Privy button at all; the injected Connect from STEER-2058 item 1 is the path.
  - The Playwright project runs the injected path with a test EIP-1193 provider from a throwaway key, so it is green before Privy arrives.

## Owners

| Part | Owner | Notes |
|---|---|---|
| Privy in apps/web, with `data-testid` attributes | cs-ui | A follow-on packet after ui-A (wagmi injected) is green: ui-A2 privy. Privy's embedded wallet is a wagmi connector beside the injected one. The Connect button offers Privy only when `VITE_PRIVY_APP_ID` is set. Every screen in the scope gets `data-testid` on its actions, and cs-e2e posts the list it needs. |
| Privy verification on the hub | cs-e2e writes the packet; orch-cs reviews as the hub owner | `@privy-io/server-auth`, active only when `PRIVY_APP_ID` and `PRIVY_APP_SECRET` are set. It verifies the access token on the routes the human flow calls as a signed-in person; the packet names them. With the variables unset, behaviour is unchanged. |
| `e2e/human` | cs-e2e | The Playwright project, the funding setup and balance assertion, the separate report, and the CI workflow `.github/workflows/human-e2e.yml` (nightly plus on-demand, no `pull_request`). CI config is a global-lock artifact, so it lands alone. |
| Docs | cs-readme | Amend D14, since the headless browser is no longer cut, and add `docs/e2e-human.md` with how to run it and the Privy fallback. The status.md row flips only when it runs green. |

## Order

Writers stay under the cap. The order is:

1. the STEER-2058 console packets, because the 21:45 report comes first;
2. ui-A2 privy, after ui-A;
3. e2e/human;
4. the hub's Privy verification.

The PR queue (#164, the #97 packet) still goes first for review.
