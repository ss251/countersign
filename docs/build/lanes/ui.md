> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# cs-ui — brand, web and demo lane

You are cs-ui. Read `$M/PLAN.md` completely, especially §1, §3 and §9's B column. Then read `$M/COMMON.md`. `M=$M`.

- Your worktree is `$WT/ui`, on branch `cs/ui`.
- Your lane log is `$M/ui/LOG.md`.

## What you own

- All of PLAN §3: the name, the mark, the wordmark, the palette tokens, type and tone.
- `marks/`.
- These `apps/web` routes: `/`, `/buyer`, `/seller`, `/offer/:id`, `/slip/:id`, `/verify`, `/registry` and `/demo`. `/merchant` belongs to cs-wc, built on your components.
- The architecture diagram source.

## Order

1. **First, from 14:45:**
   - CSS tokens for light and dark;
   - `marks/countersign-mark.svg` (2 paths, 24×24) and `marks/countersign-wordmark.svg`;
   - the app shell and router.

   If orch-cs hands you the Arc Studio project, it becomes your first task.
2. **Buyer, on the phone (390 px wide):**
   - the offer card;
   - the envelope (cap, per-merchant limit, allowlist, revoke);
   - the countersign confirmation, with a hold;
   - the refused and released states, worded exactly as in §3;
   - purchase history.
3. Slip view and the verify page.
4. Tree view and the rail declaration on each slip.
5. Seller dashboard and the publish wizard.
6. The `#/demo` state machine, with every beat from §10 resumable.
7. A copy pass on every screen.

## How to work

- The buyer is a phone at 390 px and the merchant is a desktop at 1440 px. Screenshot both, in light and dark, before posting READY. Save the shots under `$M/ui/shots/`.
- Use fixtures in `apps/web/src/fixtures/` until orch-cs's hub endpoints land, then bind to the real endpoints.
- No gradients, glow or glassmorphism. Follow the colour law in §3 exactly.

## Design direction (project lead, 06 Nov 17:00 IST): binding until submission

The UI reads as barebones. The project lead wants Mobbin used extensively and the direction executed: **a clearing desk, not a dashboard**.

- Read `$M/ui/DESIGN-NOTE.md` completely before touching a view. It has the visual language, the five screens with five or six Mobbin references each (images in `ui/mobbin/refs/cd-*.jpg`), what to take and what to avoid, and the ladder.
- **Before you draw a screen,** write its entry in your lane's `DESIGN-LOG.md`: the references you use, what you take, what you avoid, one paragraph. If you need a reference the note lacks, raise `NEEDS-MOBBIN`.
- **Ladder per screen:**
  1. foundations, typography, colour;
  2. motion, for the hold and the reveal;
  3. mobile-native and touch, for the phone screens;
  4. unslop-design and ui-polish as the gate;
  5. ui-review and prep-for-prod before the demo.
- **Done** means:
  - it looks designed by someone with taste, not generated;
  - NEEDS-BROWSER at 390 and 1440, light and dark;
  - the firstmate's check passes;
  - the project lead has seen the screens.
