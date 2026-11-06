> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 5fd109e (PR 80, TheRealRajdeep) — Circle CLI reads the hub's discovery, buyer reads Circle's catalogue
Reviewer: cs-w1. Result: **blockers=0 should-fix=3**. `bun test apps/hub packages/buyer` green. No dependency, script or lockfile changes; files are hub discovery, the buyer catalogue reader and CLI, an interop script, docs and an e2e flow.

## Held
- A catalogue listing never authorises a payment: `buy` re-reads the offer from the named hub and the offer must hash to the requested hash (B6), terms are checked against that offer, and only pinned rails or a pinned Gateway are signed for. `payableVia` is display only.
- The hub's discovery output now matches Circle's flat shape (the `data` wrapper is gone and the reader accepts both); the call-body schema wraps the input as `{input, lineage?}` as the hub actually expects. Delisted offers stay out. No keys in the interop script.

## Should-fix
1. **One hostile catalogue item crashes the listing.** `discover --catalogue` calls `BigInt(req.amount)` on a string the item's validation only checks is a string. An amount such as `"1.5"` throws a `SyntaxError` and the command prints nothing for every other item. Parse with `parseAtomic` in a try and skip the item.
2. **Terminal escapes.** Provider names and resource URLs from an untrusted catalogue are printed raw. Strip control characters before printing.
3. **`buy <callUrl>` takes its hub from the listing.** The offer hash check keeps the offer honest, but the hub is wherever the catalogue says, including an internal address. Fine for a person typing a URL; if an agent or the MCP server reaches this path, restrict it to https and non-private hosts or an allowlist, and say so in the docs.
