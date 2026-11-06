> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2245: the prize selection, the AI-use disclosure, Railway, and Arc Studio

From the project lead at about 22:45 IST: four answers from the rules and the dashboards.

## 1. Prize selection (orch-cs writes it into the submission note)

We may select up to 3 Partner Prizes, and a partner's several tracks all count as the same single pick. So our selection is exactly three picks, with no fourth:

- **Arc** (all three tracks);
- **Whitechain** (Scale and Operate);
- **Hedera** (AI Agents That Pay).

The Finalist option is chosen separately, on top of those. The README, the pitch and the demo script never imply any other track: not Whitechain Tokenize or Continuity, and not a fourth partner.

## 2. The AI-use disclosure, a submission requirement (owner: cs-readme; cs-truth reviews the sanitising; the firstmate runs the final gate)

The rules make us document where AI was used. Because we run a spec-driven workflow, the repository must include **the specs, prompts and planning artefacts**, not just the code.

**`docs/build/`** holds:
- the plan (`PLAN.md`);
- the common brief (`COMMON.md`);
- the lane briefs;
- the steers (`STEER-*.md`);
- the review notes (`reports/review-*.md`);
- the audits (link `docs/audits/`).

The packets are already in `.packets/` (115 files on cs/int), so `docs/build/README.md` links them and explains the workflow in a few lines:
- Opus lanes plan, design and review;
- DeepSeek workers execute decided packets;
- a reviewer clears every diff;
- the e2e suite and the chain are the evidence.

**The README** gets the AI-use disclosure: a three-line summary plus the pointer to `docs/build/`.

**Sanitising is mandatory before anything lands.** It is a script, not hand edits, and it re-runs on every copy:

- **No keys or secrets.** gitleaks passes on the PR diff. Environment-file contents never appear, only variable names.
- **No local machine details.**
  - Home paths (home-directory paths) become `$M` for the mission directory and `$R` for the clone.
  - Hostnames (`the build machine`, the second machine's tailnet name) become "the build machine" and "the second machine".
  - No email addresses. No Railway, GitHub or Privy secrets; public ids are fine.
- **No direct address.** "The project lead" becomes "the project lead" in the published copies.

The firstmate greps the PR diff for these terms before the merge.

## 3. Railway

The Railway App is already installed on the ss251 GitHub account, but the per-service **Connect Repo** click did not open a picker under automation. One click remains, in the dashboard, and it goes to the project lead:

> web service → Source → Connect Repo → `ss251/countersign` → branch `main` → root `apps/web`

Once it is done, orch-cs confirms that a push to main redeploys the console (A5: production runs only main's commit), and status.md's Railway row flips.

## 4. Arc Studio: decide within the hour (by about 23:45)

The CLI has no deploy or publish command, only a list of deployed contracts. So the only route to a logged-out link is the web Share panel's Netlify or Hugging Face integration, and Vercel is ruled out.

**The decision:**
- either connect one of those two;
- or drop the Studio track from the pitch.

A track we cannot qualify for is worse than one we never entered.

The firstmate tries the Share panel once, in the project lead's Chrome, as soon as that browser is free. If it needs a Netlify or Hugging Face sign-in the firstmate cannot do, it asks the project lead once. With no link by 23:45, orch-cs and cs-readme drop the Studio track from the pitch, the README and the submission note, and status.md keeps the row as NOT BUILT, with the reason.
