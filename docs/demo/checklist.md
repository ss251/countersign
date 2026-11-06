> Source: Grok 4.7 at xhigh, through its CLI, 06 Nov 2026, about 22:00 IST.

The checklist has to name the real URLs, commands, and balances, so I am pulling those from the demo repo before writing the run-of-show.The demo is Countersign. I am reading the runbook, chain config, and the verifier so the checklist uses the commands that actually exist.Checked just now. The hub, the console, the phone page, and the relay are up. The facilitator still lists Hedera testnet with fee payer `0.0.9185802`. Every live offer has a **120-second** deadline, and the laptop runner delivers by itself. A phone seller goes offline if that page leaves the foreground. Opening the camera drops the socket after **45 seconds** without a heartbeat.

## Ten live failures

1. **Registry flips Offline, buy returns `503 seller offline`.** The runner socket died: the phone locked, the tab was backgrounded, or the local process exited. Restart `serve` or wake `/phone/`, refresh, and buy only after Online. Do not resend a buy that already printed a transaction hash.

2. **Offers have no explorer links.** This browser is on `?hub=off` or a stored "off" choice, so the page is sample data. Open `https://web-production-a58de.up.railway.app` with no query and hard-refresh.

3. **The Arc buy sits forever after the signature.** The Arc RPC or the hub submitter stalled. Wait. Do not Ctrl-C and send again, or you race the nonce. No hash after 30 seconds: abandon the chapter. The hosted hub's RPC cannot be swapped on camera.

4. **The moved price never reverts on chain.** The CLI prints `Refused. The price moved after you signed.` and the explorer is empty, because the hub rejects before broadcast. The mined revert is a separate `fund` at twice the signed amount, error `CountersignatureMismatch`. Send the pre-staged force from the stranger key with a gas limit. If that key is dry, open `https://explorer.testnet.arc.io/tx/0xca61627848d1ea952c5953ac58df7b8bd780777563e24ebccf5bb90315d20e76` and call it an earlier transaction.

5. **The job refunds while you are still talking.** The deadline on every live offer is 120 seconds, and the janitor refunds about 30 seconds after it. Use the laptop runner so delivery is a log line. If the phone is the seller, keep `/phone/` in the foreground and do not open the camera until the tap. A refunded job is a dead take.

6. **The hashes "don't match."** You compared the transaction hash with the slip. `Released` stores `slipHash`, the hash of the slip body, not the transaction and not the settlement receipt. The verifier's `ok hash` line has to equal the `slipHash` in that release's log.

7. **The verifier prints `VALID (offline…)`.** `--rpc` was omitted, or `https://rpc.testnet.arc.network` timed out. Rerun with `--rpc`. Keep the beat only if the `onchain` line is there.

8. **Whitechain never funds, or the buyer holds WBT.** The relay allowlist is only `0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c`. Buy `whitechain-dev` `0x54cfd91f…` only. `https://rpc-testnet.whitechain.io` is chain **2625** and lies about balances. `cast chain-id --rpc-url https://rpc.testnet.whitechain.io` must print **1874**. Buyer `0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298` must show **0 WBT** before and after. If `https://whitechain-relay-production.up.railway.app/status` shows no remaining ceiling or under **0.02 WBT**, skip the chapter.

9. **Hedera takes the wrong rail, or the "expired" transfer moves.** Offer `0xc0ceb0a0…` defaults to `hedera-scheduled`, which does not use the facilitator. Production runs no plain x402 Hedera rail (`HEDERA_RAIL` is off), so there is no x402 beat: Hedera is the held purchase only. For the untouched expiry, stop the Agent Kit runner first, or the seller signs and the schedule executes. The honest frame is one signature and `executed_timestamp` null. It expires about five minutes later. If it is still pending, do not say expired. Already expired, untouched, from earlier: schedule `0.0.11341332`.

10. **You kill the wrong hub.** A local Ctrl-C while the Railway console still lists offers looks fake. Stopping Railway kills the console too. Kill only the local process from the checklist. Frame that terminal. Leave `https://hub-production-e85e.up.railway.app` up. The verifier reads the slip file and Arc.

## Thirty minutes out

1. Do Not Disturb, charger, one browser profile, no `?hub=off`.
2. `curl -fsS` these. All must be 200: `https://hub-production-e85e.up.railway.app/healthz`, `https://web-production-a58de.up.railway.app/`, `https://web-production-a58de.up.railway.app/phone/`.
3. `curl -fsS https://hub-production-e85e.up.railway.app/rails` lists exactly escrow `eip155:5042002`, whitechain `eip155:1874` and `hedera-scheduled`: no `gateway` and no plain `hedera`.
4. `cast chain-id --rpc-url https://rpc.testnet.arc.network` prints **5042002**. Whitechain, as above, prints **1874**.
5. Balances, read just now. They must still clear these floors:
   - Arc buyer `0x564De1D836f4e41064B2Cb1B18fF75D1BcCd0f90` USDC ≥ **0.10** (now 0.92). Hub relayer `0xE37F64A73225f5eA06BABcb1cc5440F01446C267` native ≥ **0.10** (now ~2.85).
   - Whitechain buyer USDT ≥ **0.05** (now 14.24) and WBT **== 0** (now 0). Relay `balanceWbt` ≥ **0.05** (now 1.42) and `remainingWei` still `50000000000000000`.
   - Hedera `0.0.11337064`: USDC ≥ **1.00** (now 18.87), HBAR ≥ **0.50** (now 0.575). Top up at `https://portal.hedera.com/faucet` to ≥ **2 HBAR** before a second schedule. Seller `0.0.11338176` ≥ **0.05 HBAR** (now 0.46) if it will countersign.
6. Registry shows Online: `use-arc` `0xdd24c0f8…`, `whitechain-dev` `0x54cfd91f…`, Agent Kit `0xc0ceb0a0…`. Phone offers stay Offline until `/phone/` is foregrounded. If the phone is the seller, the address on that page must stay `0xce1e838Cb01B908049C2Eb90b3Da4d71cC887915`. Do not clear site data.
7. `bun packages/buyer/src/cli.ts envelope show` still covers another 0.01.
8. One Arc buy now, off camera. Save the slip. `bun packages/verify/src/cli.ts <slip> --rpc https://rpc.testnet.arc.network` prints `VALID` and an `onchain` line whose hash equals that `Released`. Repeat for `docs/demo/slip-4320274e.json`.
9. The stranger key holds ≥ **0.05** Arc native, or you have decided to show `0xca61…0e76` as an earlier transaction.
10. Leave the kill-scene hub up: `PORT=8787 ARC_ESCROW=0x19c27D770969291E6A0a305dc1Be1a845E7c1b76 ARC_RPC_URL=https://rpc.testnet.arc.network bun run hub`, then `curl -fsS localhost:8787/healthz`.

## Cuts

Safe to re-record: the connect shot, the registry, the moved-price revert, the one-byte tamper, and the five-minute wait on a schedule if both frames show the same schedule id. Whitechain and Hedera are their own chapters.

One continuous take: the Arc buy through that job's `Released` and the matching `slipHash`. Whitechain from buyer WBT `0`, through the relayer-paid transaction, back to WBT `0`. The schedule create through the mirror page of that id with one signature. Then Ctrl-C, the failed health check, the verifier, the `onchain` line, and `VALID`, on the slip from the Arc take.

## If the network dies

Honest: stop. Name the dead hop. Do not stand in a rehearsal transaction. Resume that chapter only when the same command passes. A chapter with no receipt from this session stays out.

Shortened, and it needs no chain: kill the local hub. Run `bun packages/verify/src/cli.ts docs/demo/slip-4320274e.json` with no `--rpc`. It prints `VALID (offline: the chain was not read)`. Set the amount to `10001` with `jq` and verify that file. It prints `INVALID`. Say the chain was not read, and that no payment moved in this take.
