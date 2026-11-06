> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2225: the wallet-drainer warning, and a real pass on the buyer, assistant and seller screens

From the project lead at about 22:25 IST. Two jobs. The second one can kill the demo if we ignore it, so it goes first.

## Job 2 (urgent): MetaMask warns the site "shows signs of phishing or wallet-draining activity"

**What the firstmate found:**
- Our hostnames are on neither of MetaMask's lists: the GitHub `eth-phishing-detect` list (116k entries, including nine other `up.railway.app` hosts, but not ours) and its live stalelist and hotlist feeds.
- So the warning is **Blockaid's scan**, which MetaMask shows when a wallet connects or a signature is requested.

### Fix 1: a custom domain

A dedicated hostname, pointed at Railway by CNAME, is the only real cure, and it also looks like a product. The project lead is being asked for the domain.

**Owners:**

| Who | What |
|---|---|
| The project lead | The DNS records at his registrar: the CNAME, plus any TXT record Railway asks for. |
| orch-cs | The Railway side: add the domain to the web service and post the CNAME target. |
| orch-cs | The hub's CORS, if it pins the console's origin. |
| The firstmate | The Privy allowed origins: add `https://<domain>`, in the project lead's Chrome. |
| cs-ui | Any hard-coded origin in apps/web. |
| cs-readme | The README and docs links. |
| cs-phone | The iPhone card's URL. |

### Fix 2: false-positive reports

- **Blockaid:** the form at `report.blockaid.io` ("Mistake") is filled in, in the project lead's Chrome: domain, chains, wallet, the Arc escrow address and a plain description. Its last step is a typed code (a captcha), which the firstmate does not complete. **The project lead types the code and presses Next**, then the case id is logged here.
- **MetaMask:** our host is on none of its lists, so there is nothing for its phishing repo to remove. The MetaMask path is the Blockaid report.

### Fix 3: hygiene, so we never look like a drainer

cs-ui owns this, and it ships before anything else on the console. It is code-level, with a test for each point.

1. **Connect only on an explicit click.**
   - Nothing touches the wallet on page load: no `eth_requestAccounts`, and wagmi `reconnectOnMount: false`.
   - No chain switch on load. A switch happens only on an explicit click, with a plain line saying why.
2. **Never call `eth_sign`.** No `personal_sign` or `signMessage` for anything that moves money, and no `approve`, `permit` or `setApprovalForAll` anywhere. A test greps the built bundle for these.
3. **Plain words next to the typed data.** Before the wallet opens, the page shows the offer, the payee, the amount, the chain, the job id and what happens next.
4. **Every signature is scoped to one job:** the jobId sits in the typed data.
5. **Never ask for a signature that cannot settle.** A signature request that goes nowhere is exactly the pattern that gets flagged, and it is also the fake-countersign problem the project lead already called out.
   - The wallet opens only where the hub will take the signature and settle it, like Start here's real countersignature.
   - Every other place stays a labelled preview that opens no wallet.

Post DONE with the grep and the tests.

## Job 1: a real pass, not polish, on the buyer, assistant and seller screens

The project lead said plainly that these are not good enough.

**Rules:**
- **Opus owns the pixels** (no DeepSeek), and the emil ladder applies: `emil-design-eng`, `emil-ui-polish`, `emil-forms-and-inputs`, then `emil-ui-review` before READY.
- The firstmate shoots every screen at 390 and 1440, light and dark, into `~/Developer/firstmate/tmp/ui-shots`.

| Screen | The project lead's acceptance | Owner |
|---|---|---|
| Buyer | Wallet state; the envelope with limits that actually persist (A2); pending approvals and history. It never claims a signature it did not make. | cs-ui |
| Assistant | Real search results. A countersign card that either signs and posts, or is clearly labelled a preview. | cs-ui |
| Seller | Its real listings from the hub, the publish path, and the twenty-line integration block generated from our own paywall (the same generator as the merchant screen, STEER-2210). | cs-ui |

**Load-balancing:** the merchant screen's work from the STEER-2210 amendment moves from cs-ui to **cs-phone** (Opus, apps/web experience, mostly waiting), with cs-wc. That covers refund and export on the live order list, the integration block and the relayer panel.

## Order

1. Hygiene (Fix 3).
2. The Privy production purchase.
3. The contract fixes.
4. The buyer, assistant and seller pass, and the merchant screen (cs-phone).
5. Everything else.

The custom domain goes in the moment the project lead names it.
