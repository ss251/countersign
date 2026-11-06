> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer for cs-hd, 16:20 IST: start hd-06 (MPP) now

The project lead's word: MPP is the one rail he asked for by name, and today it is only a name in the rail type, the fixtures and the wizard. Start `hd-06-mpp-rail` now as a fourth writer. Do not wait for a slot. This is a one-time exception to the three-writer cap for this packet only (COMMON, Workers); orch-cs knows. Check `sysctl -n vm.loadavg` first, and wait only if it is above 24 (it is about 5.5).

Amend the packet with these points, commit the amendment on `cs/hd-06`, then launch:

1. **Dependencies.** `mppx` and `stripe` are both real dependencies of `packages/rail`; pin current versions (`npm view stripe version`). Tests use the mock Stripe client only. A live-mode client factory may exist, but nothing calls it unless a test-mode key is present, and it refuses any key that does not start with `sk_test_` or `rk_test_`. The worker never reads a key, an env file or a config directory.
2. **Floors, both.** Stablecoin: 0.01 USDC. Card: 0.50 USD, whole cents only. `challenge` offers only the methods whose floor the price meets, and refuses outright a price under 0.01. A 0.05 USDC offer, our usual demo price, must still get a stablecoin challenge; today's packet would refuse it.
3. **Stablecoin method.** Use mppx's stablecoin (Tempo) method if it can be exercised offline against a mock. If it needs a live Tempo RPC or the real deposit address, build the challenge and the floor, stop at verify, and say exactly what is missing in the report.
4. **Same interface as the other three rails:** declaration, challenge, verify, settle. Hub wiring stays a follow-up packet.
5. **The proof is `npx mppx@latest validate` against the local endpoint.** If validate cannot pass without live sandbox credentials, stop, paste its output in a comment on issue #5, and say so plainly there. Never fake a green, and never skip a test to get one.

Post `START hd-06-mpp-rail` with the live writer count, then READY/DONE as usual. When hd-06 is green, queue the hub-glue packet behind it.
