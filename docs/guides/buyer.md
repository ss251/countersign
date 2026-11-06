# Buyer guide

How to let an agent pay for calls through a countersign hub, inside limits you set, and check what it got. Everything here is on testnets.

## What you need

- [bun](https://bun.sh) 1.3 and a clone of this repository, with `bun install --frozen-lockfile` run.
- An agent key, as `CS_BUYER_KEY`. It signs payments and never leaves your machine. Fund it with testnet USDC for the rail you will use:
  - Arc: [faucet.circle.com](https://faucet.circle.com);
  - Hedera: [hedera.md](../hedera.md#setup).
- The URL of a hub. Every command takes `--hub <url>`; the default is `http://127.0.0.1:8787`.

The agent keeps its state in `~/.countersign`, or in `--state <dir>`:

- `envelope.json`, your limits;
- `journal.jsonl`, every reservation, signature, refusal and close;
- `slips/`, the receipts;
- optionally `rails.json`, extra rails you pin yourself.

## 1. Set the envelope first

The agent signs nothing without an envelope. Amounts are in USDC.

```sh
export CS_BUYER_KEY=<a testnet key>
bun packages/buyer/src/cli.ts envelope set --cap 1 --per-merchant 0.5 --ask-above 0.1
bun packages/buyer/src/cli.ts envelope show
```

| Flag | Effect |
|---|---|
| `--cap <usd>` | Total the agent may spend |
| `--per-merchant <usd>` | Most it may spend with any one seller |
| `--ask-above <usd>` | Above this, a call is held until you approve it |
| `--allow <seller or offerHash>` | Only these may be paid. Repeat it to add more. An empty list means any. |
| `--revoke` / `--unrevoke` | Stop all spending, or allow it again |

Before signing anything, the agent checks, in this order:

1. revoked;
2. expired;
3. the allowlist;
4. the cap;
5. the per-merchant limit;
6. ask-above.

It then reserves the spend in the journal under a file lock, so two calls at once cannot both fit under one cap. A refusal says why, for example "Refused. This would spend 5.000001 of a 5 budget."

## 2. Find an offer

```sh
bun packages/buyer/src/cli.ts discover --hub <hub>
bun packages/buyer/src/cli.ts discover --catalogue <hub>/discovery/resources
bun packages/buyer/src/cli.ts discover --catalogue circle "web search" --limit 20
```

`discover` lists the hub's offers: the first ten characters of the hash, title, price, rails and whether the seller is online. `buy` needs the full hash, from `GET <hub>/offers` or the offer's call URL. `--catalogue` reads any x402 Bazaar list, Circle's included, and marks only the items this agent would pay: those whose escrow or Gateway is pinned. A listing never adds a rail. See [interop.md](../interop.md).

## 3. Buy

```sh
bun packages/buyer/src/cli.ts buy <offerHash> --input '{"section":"Network details"}' --hub <hub>
bun packages/buyer/src/cli.ts buy <hub>/offers/<offerHash>/call --input '{}'
```

`--rail <id>` limits the choice to one rail. `--approve` clears an ask-above hold for this call.

To approve held calls from your phone instead, pass `--approvals hub` and put the phone's approver address in `approver` in `envelope.json`. The phone signs each decision with that key, and the agent checks the signature against its own request before it signs anything. The hub's word never clears a hold, and one approval clears one call ([spec/envelope.md](../spec/envelope.md)).

What the agent does, and where it refuses:

1. **Fetches the offer** and refuses unless it hashes to the hash you asked for.
2. **Refuses** a delisted offer, an offline seller, or input that fails the offer's input schema. Nothing is paid.
   - If the offer names an ENS seller, the agent resolves the name on Sepolia itself. It refuses unless the name resolves to the seller and every EVM payee is that address. Set `CS_ENS_RPC_URL` to use your own endpoint.
3. **Asks for the 402** and compares every field it would sign with the offer it fetched: payee, amount, offer hash and delivery window. It also checks the escrow, token and chain against its pinned rails. Any mismatch is a refusal before signing.
4. **Checks the envelope** and reserves the spend.
5. **Signs once and pays.**
6. **Verifies the slip:**
   - its hash;
   - the seller's signature;
   - the job, offer and amount;
   - the hashes of what it sent and what it got;
   - the output against the offer's schema.

   A slip that fails is journalled as `bad-slip`. The hub releases the escrow before it answers you, so by then the money has usually gone to the seller already. The answer depends on what the escrow says, not on the slip:
   - `jobOf(jobId)` reads Funded: the job was never released, and it refunds after the deadline;
   - it reads Released: the seller was paid. The escrow's `Released(jobId, slipHash)` event is your evidence of which slip the payment was made against, and no refund follows ([threat-model.md](../threat-model.md)).

On success it prints the output, the slip hash and the close transaction, and saves the slip in `slips/`.

## 4. After the call

```sh
bun packages/buyer/src/cli.ts journal   # every entry, one JSON line each
bun packages/buyer/src/cli.ts resume    # close out jobs left open
```

`resume` asks the hub about each open job. For a job the hub says was refunded, the spend comes back to your budget only after the escrow's `jobOf` on chain says refunded. The hub's word is not enough.

Verify any slip yourself, without the hub:

```sh
bun packages/verify/src/cli.ts ~/.countersign/slips/<slipHash>.json --rpc https://rpc.testnet.arc.network
```

Without `--rpc` it proves who signed what, and prints `skip` for the chain check. With it, it also requires the escrow's `Released` event to carry the slip's hash.

## When delivery fails

| Rail | What happens to your money |
|---|---|
| `escrow`, `whitechain` | Until the job is released, it stays in escrow and comes back in full by `refund` after the deadline. The hub sweeps these refunds, and anyone else may call `refund` too. Once released, it is the seller's. Read `jobOf(jobId)` to see which. |
| `hedera`, `gateway` | It was paid before delivery. Nothing in this repository returns it. |

So prefer escrow rails for a seller you do not know, and keep direct rails for small amounts.

## Pinning more rails

The agent signs only for the escrows and Gateways in `packages/buyer/src/known-rails.ts`. To trust another escrow, add an entry to `rails.json` in the state directory, with the same fields:

- `network`, `scheme`, `chainId`;
- `escrow`, `token`, `tokenName`, `tokenVersion`;
- `rpcUrl`.

Only pin an escrow whose deployment you have checked. A pinned rail is a promise that its escrow is the real contract.

## What to keep safe

- **The agent key** can spend up to your envelope's limits. The envelope is enforced by the agent's own code, so keep the cap small, and `envelope set --revoke` stops it.
- **The journal and slips** are your record of what was spent and received. Back them up with the key.

## Limits to know

- Without an `approver` in the envelope, a held call clears only with `--approve` on this machine.
- `accept <jobId>` and `dispute <jobId>` exist for the escrow v2 review window. No deployed escrow has that window yet (#98), so they have nothing to act on today.
- `buy <callUrl>` fetches any `http` or `https` host, private addresses included (an open finding on #25). Do not let untrusted input choose the URL. The envelope's allowlist limits who is paid, not which hosts are fetched.
- [threat-model.md](../threat-model.md) lists what a hostile hub or seller can still do.
