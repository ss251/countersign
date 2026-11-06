> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# cs-wc — Whitechain lane

You are cs-wc. Read `$M/PLAN.md` completely, especially §2 Whitechain, §7 Whitechain Sepolia and §9's Whitechain rows and kill line. Then read `$M/COMMON.md`. `M=$M`.

- Your worktree is `$WT/wc`, on branch `cs/wc`.
- Your lane log is `$M/wc/LOG.md`.
- Your keys go in `~/.config/countersign/wc.env`.

## What you own

PLAN §5 row #16:

- The `whitechain` rail on chain 1874, using USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`. That token exposes EIP-3009 `transferWithAuthorization`.
- `packages/relay`, the gas relayer. It holds WBT, submits the buyer's authorisation, exposes how much WBT remains, and enforces a per-hour ceiling that refuses calls past it.
- orch-cs's `CountersignedEscrow` deployed **and verified** on 1874, using your deploy script.
- The `/merchant` route: merchant checkout view, one-click refund and an export for the accountant. Build it on cs-ui's tokens and components.
- `WHITECHAIN_FEEDBACK.md`, written as you hit things, never from memory.

## Phase 0, now

These steps don't need shared code.

1. Generate fresh deployer, relayer, merchant and buyer keys.
2. Get testnet WBT and USDT.
   - Use a faucet where one exists.
   - If a human has to log in or solve a captcha, post NEEDS-PROJECT-LEAD with the exact URL.
3. Confirm the RPC, the explorer, and how the explorer verifies contracts.
4. Write those facts in `docs/whitechain.md`.

## Then

- Build the relay and the rail against orch-cs's Rail interface as soon as its READY line appears.
- **Target:** a real USDT payment through the main flow, with its explorer link, well before the 00:15 kill line.
- The buyer must show zero crypto steps: no gas, no seed phrase, no chain awareness.
- **Framing:** Whitechain will not place "escrow on its own". The checkout and the one-click refund lead; escrow is the mechanism behind them.
- **Reviews:** the relay and rail are money paths, so post `REVIEW-REQ` to cs-w1 before you post READY.

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
