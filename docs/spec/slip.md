# Slip

The receipt a released call leaves behind. It proves itself without the hub. Code: `packages/core/src/slip.ts`. Verifier: `packages/verify`.

A slip is `{body, hash, sellerSig, payment, settlement}`:

- `body` (`SlipBody`) holds the rail and network, the offer hash, the job id, the buyer, seller, payee, asset and amount, `inputHash` and `outputHash` (canonical JSON hashes of what was sent and returned), `deliveredAt`, `children` (slip hashes of purchases made while serving this call; always empty today, because receipt trees are not built, [#18](https://github.com/ss251/countersign/issues/18)), and on escrow rails the escrow address and chain id.
- `hash = keccak256(canonicalJson(body))`.
- `sellerSig` is the seller's EIP-712 `Release(bytes32 jobId, bytes32 slipHash)`. On escrow rails the domain is the escrow's own, so the contract checks the same signature before it pays. On other rails the domain is `{name: "Countersign", version: "1"}`.
- `payment` is the buyer's payment exactly as it was sent.
- `settlement` is where the money finished: the release tx, the transfer tx or the Hedera transaction id.

## Verifying

`bun packages/verify/src/cli.ts <slip.json> [--rpc <url>]` prints one line per check, then `VALID` or `INVALID`:

| Check | Without `--rpc` | With `--rpc` |
|---|---|---|
| hash | body hashes to `hash` | same |
| seller | `sellerSig` recovers to `body.seller` | same |
| terms | the countersigned terms derive `body.jobId` and match the body's offer, payee, amount and buyer | same |
| countersignature | the buyer's EIP-3009 signature recovers to the buyer | same |
| onchain | **not checked**: printed as `skip` | reads the settlement receipt and requires a `Released(jobId, slipHash)` log from `body.escrow` in a successful tx |

The verifier imports nothing from the hub, and a test enforces that. Without `--rpc` it never claims the money moved. It proves who signed what, and says the chain was not read.
