> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 17:30 IST: production must be live, not fixtures (the project lead's audit)

## What I verified in a clean browser on production (main 41f5092)

**Live** through the console's same-origin `/hub`:
- the overview (1 offer on 3 rails: escrow, gateway, hedera);
- the registry;
- the offer page;
- the assistant's search;
- verify (reads the chain on demand);
- the publish wizard (client-side).

**Not live:**

| Screen | What it shows | Why |
|---|---|---|
| Buyer phone (approvals, envelope, history) | "Fixture data" | `/hub/envelopes/<buyer>`, `/hub/approvals` and `/hub/jobs?buyer=` all 404 on the production hub; cs-13 is not deployed there |
| Seller dashboard | "Fixture data" | `/hub/jobs?seller=` 404s |
| Assistant envelope verdict | The fixture envelope | `/envelopes` 404s |
| Merchant desk | No hub call at all, and "RECEIVED 0.00 USDT", a false zero | `Desk.tsx` and `Receipt.tsx` import fixtures directly; the hub has no `/orders` |

**Bundle `index-Dsu4Inm2.js`:**
- it has no absolute hub URL;
- `lib/hub.ts` falls back localStorage → `VITE_HUB_URL` → null, and null means fixtures, so fixtures are the default by design;
- the fixture catalogue, with its stand-in tx hashes, ships in the default bundle.

## cs-ui (now, before more redesign)

1. **Build the production console with `VITE_HUB_URL=https://hub-production-e85e.up.railway.app`,** as the project lead asked.
   - Set it on the Railway web service, and also in `apps/web/deploy.sh`'s build env if the build runs here.
   - Before you ship, check that every hub route the console calls (GET and POST, including approvals) is CORS-open. Where one is not, orch-cs opens it.
   - Redeploy from `origin/main`. Post `DONE <sha> console redeploy` with the new bundle name, then raise NEEDS-BROWSER.
2. **The default is live.** Fixtures only with `?hub=off` and in tests.
   - Load the fixture catalogue with a dynamic `import()` only on `?hub=off`, so the default bundle carries no stand-in hashes.
   - A stand-in hash is never rendered as a link.
3. **When an endpoint does not exist or fails,** show an honest state ("this hub does not serve approvals yet", with a retry), never fixtures.

## orch-cs

4. **Ship cs-13 to the production hub first:** `/jobs`, `/envelopes`, `/approvals`. That means review, merge, promote, then redeploy the hub. Approvals also need the `HUMAN_APPROVAL_TOKEN` decision, which is with the project lead.
5. **New packet, next in the regular slot:**
   - `GET /orders?seller=<addr>&limit=`, newest first: offer title, buyer, amount (atomic), rail and network, status (held, released, refunded, partly refunded, cancelled), refunded so far, tx and explorer links per event, slip hash, timestamps;
   - `GET /jobs?seller=` for the seller dashboard, if cs-13 does not already cover it;
   - both in OpenAPI, with tests.

## cs-wc

6. **Bind `Desk.tsx` and `Receipt.tsx` to `/orders` on the chosen hub.** Fixtures load only on `?hub=off`, by dynamic import.
   - **Refunds in live mode are never simulated.** Either:
     - a real refund through a path where the merchant's key stays on the merchant's own machine (a command, like the wizard's publish-from-your-machine, or the local merchant server when it is running); or
     - the button explains why it cannot refund here.
   - A zero total is shown only when the hub really reports zero.
7. I am checking your redesign (`?fixture=1`) for design only. The merchant screen counts as real only once this binding lands.

## cs-e2e

8. **Add a production smoke flow** (curl only, no browser), run every hour. It fails loudly with a FAIL line if production slides back to fixtures:
   - the console bundle contains the hub URL;
   - the default bundle carries no fixture catalogue;
   - every endpoint each screen calls answers 200 on the production hub.
