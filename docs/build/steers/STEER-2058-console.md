> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2058: the console, fixed now and ahead of polish

From the project lead at 20:58 IST. Report at 21:45 on what is live on production.

DeepSeek writes the code. cs-w1 reviews every diff, and the firstmate reads every console diff and shoots production before and after each promotion.

## What the project lead checked

1. **There is no wallet connect anywhere in apps/web.** There is no wallet, no connect button and no Privy, so the console is read-only theatre and reads as simulated.
2. **`apps/web/public/media` is empty.** The Higgsfield hero and stings are not on the landing.
3. **The buyer section appears to turn into the Arc Studio UI without explanation.** A route or an embed is doing something we never labelled.
   - On origin/main, `apps/web/src` has no `studio`, `iframe` or `embed`.
   - The firstmate is shooting production now to find what the project lead saw, and will post `READY cs-ui` with the finding within about 10 minutes.

## The six fixes, in the project lead's order

The order is also the slot priority among console packets. Each fix below quotes the project lead's words.

1. **Wallet connect.** "Add wagmi with the injected connector plus a visible Connect button in the shell, show the address and chain when connected, and make every action that needs a signature say so instead of silently doing nothing."
2. **A normie path.** "A single 'start here' route that explains the three roles in one screen: I want a wallet, I want to sell, I want to buy. The buyer path ends in a real signature."
   - The signature is a real one from the connected wallet that the hub verifies. Prefer the countersignature on a live Arc offer, built with core's own typed data, the same bytes the agent signs.
   - A wallet without testnet USDC gets the hub's honest refusal and a faucet link, never a fake success.
   - Privy, for email or passkey onboarding, needs an app id from the project lead. The firstmate has asked for it. Ship the injected path meanwhile and do not block on Privy.
3. **The Studio-looking surface.** "Find and kill the Studio-looking surface in the buyer flow, or label it explicitly as the Studio-built console, and make sure no route silently swaps identity."
4. **The lifecycle beat on the landing.** "A four-step animated sequence: offer published, buyer countersigns, funds held, seller signs and the slip verifies, driven by real hashes and names from the hub, not lorem ipsum."
   - Honour reduced motion.
   - When the hub is unreachable, the beat says so; it never falls back to fixtures.
5. **The media.** "Copy media/final/{hero,og,sting-*} into apps/web/public/media and wire them per the handoff: poster first, preload none, never under reduced motion, ink scrim for contrast."
   - The source is `$M/media/final/` and the handoff is `$M/media/final/HANDOFF.md`.
   - **Firstmate flag:** the project lead called this generated video ugly earlier tonight. This packet ships last, and the firstmate has asked the project lead to confirm. If the project lead says pull it, it does not ship.
6. **One navigation pass.** "The same top-level nav on every screen, a visible current-section marker, and a footer that says what this is in one sentence."

## Packets

cs-ui owns all six fixes. Each gets one DeepSeek packet, in its own worktree, from origin/main.

| Packet | Fix | Notes |
|---|---|---|
| ui-A wallet | 1 | wagmi with the injected connector only. `apps/web/package.json` and the lockfile are global-lock artifacts, so only this packet touches them. |
| ui-B start-here | 2 | Starts from ui-A's head once ui-A's gate is green, because it needs the wagmi provider. |
| ui-C Studio surface | 3 | Starts on the firstmate's finding. |
| ui-D lifecycle beat | 4 | Landing files. |
| ui-E media | 5 | Landing files: rebase on ui-D. Ships last, and only if the project lead confirms. |
| ui-F navigation | 6 | Shell files: rebase on ui-A. |

## Slots

At 15:28Z no writer was alive. Fill the slots in this order:

1. orch-cs's #97 packet (STEER-2050)
2. ui-A
3. ui-D
4. ui-F
5. ui-C, once the finding is posted. Until then this slot goes to ui-E.

Next come ui-B on ui-A's green gate, and then the hub lane (STEER-2050, due 23:00).

If the project lead raises the cap to 8, slots 6 to 8 go to #27, #26 and the openapi adapter at once. Check load before each launch, and wait if the first number is above 24.

## Promotion and the 21:45 report

- **21:30:** orch-cs promotes whatever is reviewed and green, and the console redeploys from main.
- **21:35:** cs-ui posts `NEEDS-BROWSER` for production. The firstmate shoots it at 1440 and 390, dark and light, and reports at 21:45 exactly what is live.
- Anything not live by then is reported as not live, with its ETA.
