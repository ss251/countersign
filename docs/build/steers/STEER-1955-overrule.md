> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 19:55 IST: the project lead overrules the judge's cut list. This replaces item 5 of STEER-1950

Five items are back in, and none of them is marked CUT in docs/status.md:
- the approval path;
- the landing;
- the Studio link;
- ENS;
- the OpenAI-compatible endpoint.

They run beside the four verdict-flippers, only in slots that would otherwise idle.

## The next three hours belong to the flippers (STEER-1950 items 1 to 4)

1. Whitechain declared on the public hub (cs-wc and orch-cs, 20:45).
2. A green suite and LATEST.md (cs-e2e, 20:45).
   - The production-hub approvals check is not "dropped". Report it as depending on production approver configuration, in progress, until item (c) below lands.
3. The contract reconciled and deployed, with one bonded failDelivery tx (Rajdeep, orch-cs and cs-wc, about 22:45, after the project lead's re-audit).
4. The Hedera hold path as the default (cs-hd, target 00:30).

## In parallel, only in idle slots

- **(a) The landing:** merge and deploy PR #136, as built (cs-ui and orch-cs, now).
- **(b) ENS:** cs-w1 reviews PR #91 (Rajdeep's), and orch-cs merges it on zero blockers and ships it with the next promotion.
- **(c) The approval path:** `HUMAN_APPROVAL_TOKEN` on the production hub (never printed or committed), plus the console signing version 2 decisions (cs-ui). A phone that cannot approve is a product gap.
- **(d) The OpenAI-compatible endpoint, landed from cs/cs-14** (orch-cs: cs-w1 review, the one live Arc call, merge). Rajdeep is told on #53, and anything he has unpushed comes first.
- **(e) The Studio link:** the firstmate deploys the Studio-built app through Studio's Netlify or Hugging Face integration, so the Studio track has a link that opens logged out. The real console stays on Railway.

## Hard rules

- **Recording starts at 23:00 IST whatever state we are in.** The demo script is due from orch-cs by 20:30.
- **docs/status.md flips a row only when it is genuinely on main and deployed.**
