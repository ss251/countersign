# The demo: kill the hub, and the slip still proves the payment

One scene. A real slip from 06 Nov, paid and released on Arc testnet through the production hub, is verified with no hub at all: only the slip file and the chain. Then one byte is changed, and the same check refuses it.

**Artefacts (the reality rule, STEER-2120).** Each claim in this scene stands on one of these:

- the signed release tx [`0xa3898552…ff73`](https://explorer.testnet.arc.io/tx/0xa3898552f658247fc3e4e259ec61e1e99259af762e68a5b885171e41ca98ff73);
- the live URL [`/slips/0x4320274e…dadf`](https://hub-production-e85e.up.railway.app/slips/0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf) on the production hub, which opens logged out and serves the same slip as the file (checked at 15:51Z on 06 Nov);
- the verifier run VALID against Arc's public RPC, re-run at 15:51Z on 06 Nov from cs/int 35a9da9.

The slip is `docs/demo/slip-4320274e.json`, the phone's location job:

| Field | Value |
|---|---|
| Slip | `0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf` |
| Job | `0x2d4b7042f1cd6ebffc6b654ec6b2eff47431c50627a6e8cc9defe50e976de0ce` |
| Escrow | Arc testnet `0x19c27D770969291E6A0a305dc1Be1a845E7c1b76`, the v1 deployment |
| Amount | 0.01 USDC (`10000`) |
| Release | [`0xa3898552…ff73`](https://explorer.testnet.arc.io/tx/0xa3898552f658247fc3e4e259ec61e1e99259af762e68a5b885171e41ca98ff73), block 71035811 |

## Before recording

Run these from the root of a checkout of `main`:

```sh
bun install
# Optional: fetch the same slip fresh from the production hub while it is up.
curl -s https://hub-production-e85e.up.railway.app/slips/0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf -o /tmp/slip.json
cmp <(jq -S . /tmp/slip.json) <(jq -S . docs/demo/slip-4320274e.json) && echo "same slip"
```

Open two terminals:

- **Terminal A** runs a hub, so the audience can watch it die. Start it with `PORT=8797 bun run hub` (port 8787 is the local hub loop, which stays up), then check it answers: `curl -s localhost:8797/healthz`.
- **Terminal B** runs the verifier.

## On stage

**1. Kill the hub.** In terminal A, press Ctrl-C, then show that it is gone:

```sh
curl -s --max-time 3 localhost:8797/healthz || echo "the hub is gone"
```

The verifier never calls a hub, this local one or the production one. It reads only the slip file and Arc.

**2. Verify the real slip.** In terminal B:

```sh
bun packages/verify/src/cli.ts docs/demo/slip-4320274e.json --rpc https://rpc.testnet.arc.network
```

Expected output, exit code 0:

```
ok   hash              slip hash 0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf
ok   seller            signed by the seller 0xce1e838Cb01B908049C2Eb90b3Da4d71cC887915
ok   terms             the buyer agreed to this offer, payee and amount (job 0x2d4b7042f1cd6ebffc6b654ec6b2eff47431c50627a6e8cc9defe50e976de0ce)
ok   countersignature  countersigned by the buyer 0x564De1D836f4e41064B2Cb1B18fF75D1BcCd0f90
ok   escrow            known escrow: Arc testnet, deployed through Arc Studio
ok   onchain           the chain holds this slip's hash: Released(0x2d4b7042f1cd6ebffc6b654ec6b2eff47431c50627a6e8cc9defe50e976de0ce, 0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf) in block 71035811, tx 0xa3898552f658247fc3e4e259ec61e1e99259af762e68a5b885171e41ca98ff73
VALID
```

The `onchain` line is the point. The `Released` event on Arc carries this slip's hash, and the verifier recomputed that hash from the file.

**3. Change one byte and verify again.** Change the amount from 10000 to 10001:

```sh
jq '.body.amount = "10001"' docs/demo/slip-4320274e.json > /tmp/slip-tampered.json
bun packages/verify/src/cli.ts /tmp/slip-tampered.json --rpc https://rpc.testnet.arc.network
```

Expected output, exit code 1:

```
FAIL hash              body hashes to 0x27fcd02333462c5acb5cf40668073dce213031f3faa904a9002a501a9d8b1cde, slip says 0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf
FAIL seller            signed by 0x7A161d09596CE9A2F79D12a3b9eF27B7e74b8a82, not the seller 0xce1e838Cb01B908049C2Eb90b3Da4d71cC887915
FAIL terms             the countersigned terms differ from the slip
ok   countersignature  countersigned by the buyer 0x564De1D836f4e41064B2Cb1B18fF75D1BcCd0f90
ok   escrow            known escrow: Arc testnet, deployed through Arc Studio
FAIL onchain           the event hash 0x4320274e97d303c0276c293381c6e2824baa1e1a3a12d70c949829abb93dcadf differs from the recomputed hash 0x27fcd02333462c5acb5cf40668073dce213031f3faa904a9002a501a9d8b1cde
INVALID
```

The line to say: "one signature, six terms; change one byte and the slip no longer matches the chain". The six terms are the ones the buyer countersigned: the offer, buyer, payee, amount, deadline and salt.

## Honest framing

- **The hub killed on stage is a local one.** The slip came from the production hub earlier today, and the production hub keeps running. What the scene proves holds for both: verifying needs neither hub, only the file and the chain.
- **The escrow is the v1 deployment,** the one the production hub settles through: deploy tx [`0x06638eb4…6c5a`](https://explorer.testnet.arc.io/tx/0x06638eb4cfa8db52b5e097778160fbc913561e88f56aa8fc2ec195cb6d596c5a).
- **If Arc's public RPC is slow,** add `--rpc <another Arc testnet RPC>`.
- **Offline,** the verifier prints `VALID (offline: the chain was not read)`, so the on-chain line needs the network.
