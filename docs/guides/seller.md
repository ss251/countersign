# Seller guide

How to sell a skill through a countersign hub, get paid, and know what you have agreed to. Everything here is on testnets.

## What you need

- Node 20 or later, and the published CLI, run with `npx -y @countersign-hub/cli`.
- A signed-in seller wallet: run `npx -y @countersign-hub/cli login` ([onboarding.md](../onboarding.md)). A signed-in seller has no key on its machine. The runner signs your offers, its login to the hub and every slip through the hub, with the Privy server wallet that the countersign app controls. Selling under a login has not yet run on production, and a bonded offer cannot be served from a signed-in session yet.
- The URL of a hub. The default is the production hub.
- A skill: a Markdown file whose front matter, between two `---` lines, has a `name` and a `description`.

## Publish and serve

`sell skill` publishes the skill and then stays connected to answer calls. Add `--publish-only` to list the offer without serving it.

```sh
npx -y @countersign-hub/cli sell skill ./SKILL.md --hub https://hub-production-e85e.up.railway.app --price 10000
```

| Flag | Meaning | Default |
|---|---|---|
| `--hub <url>` | The hub to publish to and connect to | required |
| `<SKILL.md>` | The skill to sell | required |
| `--price <atomic>` | Price in atomic units of a 6-decimal USD stablecoin: `10000` is 0.01 USDC | required |
| `--deadline <seconds>` | How long you have to deliver once paid, from 10 s to 7 days | `120` |
| `--rails <a,b>` | Rails you accept, most preferred first: `escrow`, `whitechain`, `gateway`, `hedera` | `escrow` |
| `--pay-to <rail>=<id>` | Where a rail pays, when it is not your seller address. Required for `hedera`, which pays an account id such as `0.0.1234`. | your address |
| `--upstream-url`, `--licence` | For a skill you did not write: where it comes from and its licence. They go together. | none |
| `--ens <name>` | Your ENS name on Sepolia, in normal form. It must resolve to your seller address, and every EVM payee must be that address, or the hub will not list the offer. A Hedera payee is outside the name. | none |
| `--known-escrow <chainId>=<address>` | An extra escrow the runner trusts when it checks a job on chain before working on it | the built-in list |
| `--rpc <chainId>=<url>` | The RPC the runner uses for those checks on a chain | Arc's default, `ARC_RPC_URL`, `WC_RPC_URL` |
| `--state <dir>` | Where the runner remembers each offer's `issuedAt` | `~/.countersign/runner` |

The runner prints each offer hash it published, then `runner ready`, then one line per job: `<jobId> <title> ok`, or the reason it refused.

### Your offer is fixed by its hash

The offer hash covers every field, the price included. Changing the price, the deadline, the rails or a payee makes a new offer with a new hash, and the old one stays listed. Re-running `serve` with the same inputs publishes the same hash, because the runner keeps the original `issuedAt` in its state directory.

To take an offer off the hub, the seller signs `countersign delist <offerHash>` and posts the signature to `POST /offers/<offerHash>/delist`. Neither the runner nor the `countersign` command has a delist command yet. To stop selling, stop the runner. Your listings then show `online: false`, and calls answer "The seller is offline. Nothing was charged." before any payment is asked for.

## What a buyer's call does on your machine

1. The runner dials out to the hub over a WebSocket and opens no port. It proves it is your seller wallet by signing the hub's fresh nonce.
2. Before it works on an escrow job, it reads the job on chain and refuses one it cannot confirm. The escrow must be pinned, and the job must be Funded, pay you, cover at least the price, name this offer, and have a live deadline. So a hub cannot get free work out of you with a job that was never paid.
3. For each paid job, it runs the skill in a child process. The child gets only `PATH` and a fresh, empty `HOME`, so your other environment variables and your session never reach it. A job has 30 seconds and 1 MB of output.
4. The skill's input is `{question?, section?}`. With `section`, the runner returns that section of the skill. Without it, the runner returns the whole body.
5. The runner checks the output against the offer's output schema and signs a slip over the job, the hashes of the input and the output, and the delivery time.

If the connection drops, the runner reconnects on its own.

## Getting paid

| Rail | When the money arrives | What you receive |
|---|---|---|
| `escrow` (Arc testnet USDC) | When the hub releases with your slip signature, before the deadline | `price - toll`. The toll is 1% (`tollBps` 100) on the deployed escrow. |
| `whitechain` (Whitechain Sepolia USDT) | The same, submitted by the relay | `price - toll` |
| `hedera` (Hedera testnet USDC) | After your output checks out: the hub submits the buyer's signed transfer to your `--pay-to` account. A payment the buyer's own wallet sent before the call has already settled. | the full price |
| `gateway` (Circle Gateway, Arc testnet) | Gateway debits the buyer at once and credits you in a later batch | the full price, through Gateway |

Gas is paid by the hub's relayer (Arc), the relay (Whitechain), the facilitator (Hedera) or Circle (Gateway). You need no gas token.

## What you are agreeing to

The full terms are in [terms.md](../terms.md). In short:

- **Escrow rails.** If you do not deliver before the deadline, or your output fails the schema, the buyer gets the full amount back by refund after the deadline. The escrow also lets you, as payee, `cancel` a funded job and return the full amount to the buyer at once. The runner has no command for this yet: it is a direct contract call.
- **Hedera.** An x402 `exact` payment through the facilitator is submitted only after your output checks out, so a failed delivery pays you nothing, and you have done that run. A payment the buyer's own wallet sent before the call is not held.
- **Gateway**, a direct rail. You are paid before you deliver.
- A failed delivery counts against your rating on every rail.
- **Your rating** is derived from slips that check out, not reported by anyone ([ratings.md](../ratings.md)). A failure your runner reports counts against you. A failure that was not yours, such as the hub cutting a job short, is `excused`.
- **The bond** in your offer is declared, and production does not collect it yet.
  - The code is on `cs/int`: `runner bond deposit|withdraw|show <atomic> --escrow <address>` manages your free bond in an escrow, and the hub's delivery gate pays a locked bond to the buyer when your output fails it.
  - Escrow v2, which collects it, is deployed on Arc and Whitechain, and production settles through it for unbonded jobs only. Production refuses bonded jobs tonight ([status.md](../status.md)).

## Your wallet

Your wallet signs offers, runner logins and every slip. A slip is what releases the escrow to you, so anyone who can sign as your wallet can:

- release your funded jobs;
- publish offers in your name.

Under a login, only the countersign app can sign as it, through the hub and only for your signed-in session. `logout` ends that session, not the app's control of the wallet. The child processes that run your skills never see your session.

## See also

- [threat-model.md](../threat-model.md): what a hostile hub or buyer can and cannot do to you.
- [spec/offer.md](../spec/offer.md): every field of an offer.
- [hedera.md](../hedera.md#setup): selling on the Hedera rail.
