> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 18:12 IST: rev it up (project lead)

The project lead says the fleet is throttled by our own rule, and at sixteen hours out the only wrong answer is a fleet that is politely waiting.

1. **The writer cap is 5,** machine-wide, for the rest of the night. This is a recorded deviation, now in COMMON "Workers".

2. **The queue order is binding:**
   1. the landing;
   2. #98 support;
   3. the truth pass;
   4. everything else.

3. **The slots now.** orch-cs confirms them with one line: `SLOTS 1 … | 2 … | 3 … | 4 … | 5 …`.
   1. **cs-ui:** the landing.
   2. **orch-cs, #98 support:**
      - clear the cs-19 gitleaks block (cs-w4, 12:27:58Z);
      - get cs-w1's review, then merge into `cs/int`;
      - comment on #98 that the contract file is free, with the sha;
      - then serve the review fields on `/jobs` and `/orders`, with null where the chain does not report yet.
   3. **cs-truth:** the truth pass, which is running.
   4. **cs-13c:** in flight.
   5. **hd-06e:** granted at 12:35:40Z. Launch it now.

   **Queued next:**
   - cs-wc's in-review desk, once the hub serves the review fields. It stays off production until #98's contract is live.
   - Then the rest, in orch-cs's order.

4. **The 18:00 freeze is narrowed.** The landing and #98 support go ahead of the truth pass, and everything else waits behind it. The truth rules still apply to all work: no new claim without evidence.

5. **No silent waiting:**
   - A lane queued for more than 10 minutes posts one line: `WAITING <what for> — next: <the first thing it does the moment it gets a slot>`.
   - A lane blocked on the project lead posts one line: `NEEDS-PROJECT-LEAD <the one decision or action, with the options>`.
   - The firstmate relays both in the same turn.

6. **cs-ui: the landing is first.**
   - The firstmate is shooting your 18:04 build now, at 1440 and 390, dark and light. The project lead sees the screens before the merge.
   - You are at 89% context. Finish the commit you are on, then write `ui/HANDOFF.md`:
     - the `cs/ui` head;
     - what the landing does and what is open;
     - any unpushed work.
   - Push through cs-w4, post `HANDOFF cs-ui <path>`, and stop. Start nothing else.
   - The firstmate relaunches you fresh, with the landing review as your first task.

7. **Dropped to buy speed** (the firstmate's call, under the project lead's rev-up):
   - paid sessions;
   - unified balance;
   - the subgraph (no Goldsky account);
   - Railway preview environments;
   - a headless browser for the e2e web flows. The firstmate's screenshot rounds in `~/Developer/firstmate/tmp/ui-shots` cover the visual checks.

   **Deferred until the landing ships:** the Higgsfield rail stings and the texture loop. The OG card and the hero loop come first.

   cs-truth records the dropped items as `CUT` in `docs/status.md`.
