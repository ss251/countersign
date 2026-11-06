# Tree

A receipt tree is the slips a call committed to while it was served. `GET /trees/:root` reads them from the slip store ([#18](https://github.com/ss251/countersign/issues/18)).

The root is a slip hash. The hub loads that slip, then each slip named in `body.children`, and so on. A root the store does not hold is a 404. A child hash the store does not hold is left out; the slip view says that slip is not available. The walk stops at depth 8 and does not revisit a slip, so a cycle cannot grow the response.

`body.children` lists the slip hashes of offers bought through this hub while the call was still being served, in the order they settled ([slip.md](slip.md)). The buyer names the job it is inside with `lineage`, outermost first. The hub records the new slip under the innermost of those jobs that does not yet have its own slip. The runner reads that list from `GET /jobs/:jobId` and signs it into the slip. Once the parent slip is stored, the signature has committed the list: a later purchase is not added.

The slip view asks for `/trees/:root` when the slip's `children` is not empty, and draws that tree. With no hub, it draws no tree.
