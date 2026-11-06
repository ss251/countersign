> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer for cs-hd, 17:10 IST: MPP becomes a real Tempo testnet rail, now

The project lead's word: the Stripe blocker is solved by not needing Stripe. MPP has a native Tempo method that involves no Stripe at all.

- **Server:** `Mppx.create({ methods: [tempo({ testnet: true, recipient: <our address> })], secretKey })`, then `mppx.charge({ amount })(request)`. On Moderato testnet the currency defaults to pathUSD.
- **Client:** `mppx account create` stores an account in the keychain and funds it automatically on testnet. Then `mppx <url>` pays any 402.

Do it now: swap the method, run the CLI flow end to end against our endpoint, capture the receipt and the settlement, and put the tx in the docs and on issue #5.

## 1. Code: one packet, `hd-06c-tempo-first`, in the extra slot

Start it the moment hd-06b has exited and been reviewed, or fold it into hd-06b's review if that is cleaner. Same one-time project lead exception, which I log.

- The rail leads with `tempo({ testnet: true, recipient })`: pathUSD on Moderato, chain 42431, with a floor of 0.01.
- The Stripe SPT method stays in the code behind `MPP_STRIPE=1`. It is off by default and nobody sets it tonight.
- `scripts/mpp/server.ts` reads `MPP_SECRET_KEY` and `MPP_RECIPIENT` from the environment, serves the Tempo method on localhost, and prints neither.
- The offline tests stay green: challenge shape, the floor, the replay refusal, and the Stripe path against the mock. The guard test (no mainnet chain id or address in `packages/rail/src/mpp/`) stays.
- The worker never runs `mppx` and never holds a key.

## 2. Live acceptance, run by you and not the worker

1. **Secrets.** `umask 077`. Create `~/.config/countersign/mpp.env` with:
   - `MPP_SECRET_KEY` from `openssl rand -base64 32`;
   - a fresh Tempo testnet recipient key and its address.

   Never echo or print either. Only the address appears anywhere.
2. **Hazards** (COMMON, Secrets: read it again).
   - The stripe CLI **is on PATH** here. Run every `mppx` command with a PATH that excludes it, and with `STRIPE_*` and `MPPX_STRIPE_*` unset.
   - Use a pinned mppx version via npx or bunx.
3. **Client account.** Run `mppx account create` for the project's own payer on Moderato, funded automatically.
   - Record its address only.
   - Before paying, list the accounts. The pre-existing account `0x62Ff…1f0e` (it resolved on mainnet in hd-06) must never pay. Choose the new account explicitly; if mppx cannot do that, stop and raise NEEDS-PROJECT-LEAD.
4. **Pay.** Run the server on localhost with `mpp.env` loaded, then `mppx http://localhost:<port>/<paid path>`.
   - Read the amount and the chain before confirming: 0.01 pathUSD, chain 42431.
   - `--yes` is allowed only against this localhost endpoint, after that read.
5. **Capture:**
   - the `Payment-Receipt` (its reference, the receipt id);
   - the settlement tx hash;
   - its link on the official Tempo testnet explorer;
   - the payer and recipient addresses.
6. **Publish:**
   - add the proof to `docs/mpp.md` and `docs/proof.md`;
   - comment on issue #5 with the tx, the explorer link and the receipt id (public text only);
   - commit with `refs #5`, then REVIEW-REQ to cs-w1 for `packages/rail/src/mpp`, then the PR into `cs/int`;
   - raise NEEDS-BROWSER for the explorer link so I can confirm it opens logged out.
7. **README.** Tell cs-readme the exact line to add: the MPP rail settles on Tempo testnet (tx link), and the Stripe SPT method is implemented behind a flag, gated on a Stripe sandbox business profile.

If the real settlement cannot be made to work, say exactly why on issue #5 and in a FAIL line. Never fall back to calling the mock a settlement.
