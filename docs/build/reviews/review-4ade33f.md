> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 4ade33f (PR 185, cs/tr-03, #21, D19, STEER-2120 item 1): the hub checks a signed-in Privy person

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. This covers the packet's commits through 2d51b43 and the merge with cs/int at 4ade33f.

## Held
1. **Refusals come before any 402 or charge.**
   - `personFrom` runs right after the offer lookup in `paidCall` (call.ts:69), before the lineage check, the ENS lock and the 402. The merge kept that order.
   - A bad token is 401 bad-session on all six routes. An unreachable Privy is 503 session-unavailable.
2. **On /call, the token only refuses; it never authorises money.**
   - A signed-in person is refused with 403 not-your-wallet when the payment's verified payer is not an EVM address, or is not one of their linked Ethereum wallets.
   - The check runs after `rail.verify` and the duplicate check, and before `rail.settle`, so "Nothing was charged" is true. The test shows settle is not called for the stranger.
   - A call without the header behaves as before. That is right under D19, because the payment signature is the authority.
3. **On the approval routes, the session replaces the operator token, and each step stays bounded.**
   - The agent-signed mirror names the approver: `putEnvelope` accepts only the agent's own signature.
   - Privy's linked wallets prove that the person controls that approver.
   - A decision still needs the approver's signature over the request hash (`approvalDecisionSigner`). A session can read approvals, but it can never decide one by itself.
   - A list with no agent is refused with 403.
4. **Accept and dispute** need the person to own `job.buyer`, and the buyer's review signature is still checked.
5. **The verifier.**
   - The library checks ES256 with issuer `privy.io`, audience equal to the app id, and expiry. The app-id comparison here is a second check.
   - The library fetches the verification key once and keeps it. Each request costs only local crypto, plus one `getUserById` per person per minute.
6. **Lockfile at 4ade33f against cs/int.**
   - Every name@version in cs/int's lockfile is still present, and 50 are added (Privy's tree).
   - Top-level slots moved: jose 4.15.9, dotenv 16.6.1, bs58 5.0.0, base-x 4.0.1, commander 2.20.3, superstruct 2.0.2, and @solana/codecs-core, codecs-numbers and errors 5.5.1.
   - Every earlier dependent keeps its version through a nested entry:
     - `@x402/extensions/jose` 5.10.0;
     - cdp-sdk and the MCP SDK on jose 6.2.15;
     - `@metamask/utils` on superstruct 1.0.4;
     - the @solana packages on errors 8.6.0 with commander 15.0.0;
     - bs58 6.0.0 under cdp-sdk, reown and walletconnect;
     - hedera-agent-kit-mcp on dotenv 17.2.1.
   - No workspace imports or declares a moved name.
7. **Tests.** On 4ade33f with a frozen install, `bun test apps/hub` gives 193 pass and 0 fail across 19 files.

## Should-fix
1. **A wallet linked within the last minute is refused as not yours.**
   - The verifier caches a person's wallets for 60 s and answers from the cache without asking Privy again.
   - Suppose a hub route reads the person before a wallet is linked. A payment from that wallet within the minute then gets 403 not-your-wallet. Nothing is charged, but the purchase fails.
   - The likely case is the first production Privy purchase. With `createOnLogin: 'users-without-wallets'` (A6), the embedded wallet appears just after the first login. If the console sends the token to the hub in that gap, for example to read the envelope or approvals, the buy that follows is refused.
   - Fix: on an ownership miss, read the person once more with the cache bypassed before refusing, for example `verify(token, { fresh: true })`. One extra Privy read happens only on a miss.

## Notes
1. **Hedera payers are always refused for a signed-in person.**
   - On hedera and hedera-scheduled the payer is a 0.0.x account. A person who sends the header and pays on Hedera therefore gets 403 not-your-wallet.
   - Nothing in apps/web sends `x-privy-token` yet, on either cs/int or main, so nothing breaks today. The console change that adds the header should leave it off Hedera payments.
   - The wallet-paid rail (cs/hd-15) is different: there the buyer's transfer lands before /call. With the header, a 403 would then say "Nothing was charged" after the money has moved. I will check this combination when hd-15 is re-reviewed.
2. **Two states stay stuck until the hub restarts. Both fail closed, and neither moves money.**
   - The library keeps the verification key for the life of the process, so a key rotation at Privy makes every session a 401.
   - A failed lazy import of `@privy-io/server-auth` is kept as a rejected promise, so every Privy request answers 503.
   - Add one runbook line: restart the hub if bad-session or session-unavailable answers suddenly start arriving in bulk.
3. **The wallet cache is never pruned.** It holds one entry per signed-in person, which is fine at this scale.
