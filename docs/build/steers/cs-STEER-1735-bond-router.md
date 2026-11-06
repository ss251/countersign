> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Steer for orch-cs, 17:35 IST: two light builds, start now (project lead)

The project lead's word: stop deliberating and build the light versions. All three additions are bounded and start now. The phone runner is a new lane, cs-phone. The seller bond and the rail router are yours.

**Slots.** Run each as a DeepSeek packet in an extra slot, starting now. This is a one-time project lead exception for these two packets and their single correctives (logged). Your regular slot and its queue carry on. Wait only if load is above 24.

## A. The seller bond (money path: cs-w1 reviews; cs-e2e adds the flows)

The project lead's words: "the offer already declares bond and nothing collects it. Make it real in the smallest honest way, a bond deposited with the escrow on funding and paid to the buyer when the seller fails to deliver by the deadline, with the buyer still able to take the normal refund path when the seller does deliver nothing at all. Write the test that proves a failing seller is worse off than a silent one."

My reading, which you correct if the code or the words say otherwise:

| Case | What happens | Bond |
|---|---|---|
| **Failing seller**: delivers by the deadline, but the delivery fails the hub's delivery gate | The buyer gets the payment back | Goes to the buyer |
| **Silent seller**: delivers nothing | The normal refund path after the deadline, anyone can send it; the buyer gets the payment back | Returns to the seller |
| **Delivering seller** | Release pays the seller | Returns to the seller |

**Smallest honest mechanism.** You pick it: for example a seller bond balance in the escrow that `fund` locks for the job, and a `failDelivery` that the hub's delivery gate triggers. State the trust honestly in the safety limits: the hub's gate decides failure.

**Tests (forge):**
- the three cases above;
- **the comparison test:** the same job run twice, once failing and once silent; the seller ends exactly one bond worse off in the failing run;
- a job cannot be funded without the declared bond in place.

**If the contract must change:**
- redeploy on testnets only: Arc through Studio as before, and Whitechain 1874 with forge;
- keep the old escrow addresses, so earlier slips still verify;
- put both sets of addresses in `docs/proof.md`;
- update the hub, the rails, the verifier and the docs to the new address.

**Proof:** one live failing-seller run on Arc testnet, where the bond reaches the buyer, with tx links in `docs/proof.md` and the issue.

## B. The rail router (packages/rail; hub wiring)

The project lead's words: "a thin selection layer in packages/rail that, given an offer and the buyer's capabilities, picks the cheapest rail with acceptable finality and falls back to the next one if the first challenge or settle fails, recording which rail was chosen and why on the slip and in /healthz. Not a chain abstraction, not a bridge, just a deterministic policy with a trace."

- **The function:** `chooseRail(offer, buyerCaps, rails, health)` returns the ordered candidates with a trace per rail (eligible or not, cost, finality, why). Deterministic, with ties broken by rail id.
- **Fallback:** on a thrown challenge or a failed settle, move to the next candidate and record each attempt.
- **The slip** records the chosen rail, the reason and the attempts. Mind the hash rule: the committed hash covers the body without the settlement receipt. Decide which side the trace belongs on and write the decision in `docs/decisions.md`.
- **`/healthz`** shows the policy and the recent decisions.
- **Tests:**
  - cheapest acceptable wins;
  - finality filters a rail out;
  - a failed challenge falls back;
  - a failed settle falls back;
  - the trace is exact.

Open an issue for each build (public text only) and post START lines with the live writer count.
