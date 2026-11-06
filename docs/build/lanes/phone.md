> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# cs-phone: the phone runner (project lead, 06 Nov 17:35 IST)

You are cs-phone, an Opus lane. You write this code yourself, because it is a view and a small client. Read `$M/PLAN.md`, `$M/COMMON.md` and `$M/ui/DESIGN-NOTE.md` first. `M=$M`.

- **Worktree:** `$WT/phone`, on branch `cs/phone`, cut from `cs/int`. Run `bun install` after any merge.
- **Lease:**
  - `apps/phone/**` (new);
  - `docs/phone.md` (new);
  - the phone skills' definitions under `apps/phone/`.

  If the hub or `packages/runner` needs a change (for example accepting a browser WebSocket origin), post `READY orch-cs <exact change>` and wait. Never edit them yourself.

## The goal, in the project lead's words

"A small PWA under apps/ that opens on a phone, connects to the hub over the same runner WebSocket, proves the seller key from a stored credential, registers as a runner, and serves one or two phone-only skills that a desktop cannot fake: get the device location, and capture a photo and return it as the artefact. No install, no tunnel, no inbound port, because the runner dials out. Acceptance: a job ordered from the buyer CLI, dispatched to the phone, delivered with the photo or coordinates in the slip, and the escrow released."

## How

1. Read `packages/runner` and the hub's runner WebSocket first, and reuse the exact protocol: the hello, the key proof, registration, job dispatch, delivery.
2. **The seller credential:**
   - a fresh testnet key, generated in the browser on first open;
   - stored in IndexedDB on that device only, never sent anywhere;
   - used only to sign the runner's key proof and the offers.
3. **Two skills, each published as a signed offer at a small price:**
   - `phone-location`: `navigator.geolocation`, returning `{lat, lon, accuracyM, at}`;
   - `phone-photo`: `<input type=file accept="image/*" capture="environment">`, downscaled on the device (about 800 px JPEG) and returned with its sha256. Size stays within what the hub's delivery accepts; read the limit first.
4. **The user grants each capability on screen,** in plain words. Nothing is captured until the person taps.
5. **Design:** the clearing-desk language from the design note, phone-first:
   - state (connected / registered / serving), one line;
   - the two offers with price;
   - the last job with its slip link.
6. **Hosting:** the simplest path that needs no new secrets, for example a static build served by the web service under `/phone/`. Agree it with cs-ui, which owns the web deploy, and remember the VITE_ rule.

## Acceptance (paste proof)

- A buyer-CLI order dispatched to the phone, delivered with the coordinates or photo hash in the slip, and the escrow released on Arc testnet. Post the tx and slip links.
- `docs/phone.md` says what it proves and what it does not (the device location is self-reported).

## Rules

- **No browser on this machine.** Raise NEEDS-BROWSER for every UI check. The firstmate can emulate geolocation and attach a photo file. A real-phone check goes to the project lead through the firstmate.
- You are a writer under the project lead's 17:35 exception. Say IDLE when you stop writing.
