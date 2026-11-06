> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# STEER-2115: Privy is live, so wire it now

From the project lead at 21:12 IST. This builds on STEER-2108 and, where the two differ, replaces it.

## The credentials

- **App id:** `cmw54qend00ce0hidwpsu5p8n`. It is public, a client identifier, and safe in config and in argv.
- **The secret** is in the build machine's `~/.config/countersign/privy.env`, mode 600, as `PRIVY_APP_ID` and `PRIVY_APP_SECRET`.
  - Read it from that file only. Never print it, never put it in argv, a log, a commit or a test artifact.
  - Stage it the way cs-ui staged `HUMAN_APPROVAL_TOKEN`: the Railway variable is written from the file, and any check reads it through a header file.
- The project lead verified the pair against Privy's API: a 200 on the app object.
- **Allowed origins.** Privy refuses PUT and PATCH on these, so the project lead sets them in the Privy dashboard. Until he has, the deployed client refuses to initialise, and **the UI must fall back to injected Connect.** It never shows a dead button. The four origins are:
  - `http://localhost:5191`
  - `http://localhost:5173`
  - `http://localhost:4173`
  - `https://web-production-a58de.up.railway.app`
- **Test accounts.** The env file holds no test login. The firstmate has asked the project lead to enable Privy test accounts and to add the test email and its fixed OTP to the same file as `PRIVY_TEST_EMAIL` and `PRIVY_TEST_OTP`.

## The work

### Web: cs-ui (ui-A2 privy)

It starts from ui-A's head once ui-A is green.

- `@privy-io/react-auth`, with email and passkey login and an embedded wallet on Arc testnet (`eip155:5042002`), created for users who have none.
- `VITE_PRIVY_APP_ID` is read at build time.
- Keep the injected fallback in two cases: no app id, or Privy fails to initialise (for example, before the origins are allowed). In both, injected Connect is shown with one plain line saying why.
- Every action in the human flow gets a `data-testid`: sign-in, the wallet address, the chain, discover, countersign, the fund result, the slip and verify.
- Railway: set `VITE_PRIVY_APP_ID` on the web service now, then redeploy from main after the promotion that carries ui-A2.

### Hub: cs-truth writes the packet (an Opus design)

Auth is a trust boundary. orch-cs reviews it as the hub owner, then cs-w1 reviews it. This replaces STEER-2108's cs-e2e owner.

- `@privy-io/server-auth` verifies the Privy access token on every route that acts for a user. The packet names those routes; approvals, envelopes and the merchant's refund are likely among them.
  - A verified token identifies the person and their linked wallets.
  - An EIP-712 signature is still what authorises a money action. The token never replaces a signature.
  - With `PRIVY_APP_ID` or `PRIVY_APP_SECRET` unset, behaviour is unchanged.
  - `HUMAN_APPROVAL_TOKEN` stays as the operator path.
- Railway: set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` on the hub service from the file now. They are harmless until the code ships. Redeploy from main after the promotion that carries this packet.
- It takes the next free slot after ui-A2. It is ahead of the hub lane only if the project lead's cap stays at 5. With a cap of 8, both run.

### e2e/human: cs-e2e

This run is the acceptance gate. It goes against production, in this order:

1. Sign in through Privy with the test account.
2. Assert that an embedded wallet exists.
3. Fund it with 1 USDC on Arc.
   - Tonight's on-demand runs on the build machine send it from the deployer, as the project lead said.
   - The nightly CI run uses the dedicated test-funder key, topped up from the deployer, so the deployer's key never sits in CI.
4. Assert the balance.
5. Run the buyer flow to a real escrow `fund` transaction.
6. The seller delivers.
7. The slip verifies.

The merchant refund from STEER-2108 stays in the project as the next flow.

**What counts as done.** If a person cannot sign in and buy without instructions, the flow is not done. The report counts only when sign-in works on production, never when the code compiles. Post `READY firstmate` with:

- the run id;
- the fund transaction;
- the slip's VALID line;
- the screenshots from the trace.

The firstmate then checks production itself: the Privy modal opens on the deployed origin, and the console shows no origin error. It never enters a credential on production.
