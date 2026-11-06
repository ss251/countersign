> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# orch-cs review of packet tr-03-privy-hub (cs/tr-03 be80910, D19) as hub owner

Verdict: CLEARED with one amendment (A1) made in the packet before launch. cs-w1 reviews the diff after orch-cs.

## A1 (must, before launch): an unreachable Privy must answer 503, not 401

In @privy-io/server-auth 1.32.5, `verifyAuthToken(token, key = "")` fetches the app's verification key from Privy's API on first use (`getVerificationKey()`, then cached on the client), then runs jose `jwtVerify` (ES256, issuer privy.io, audience = app id). The packet maps every throw from `verifyAuthToken` to `PrivySessionError`, so before the key is cached an unreachable Privy answers 401 "Your sign-in is not valid. Sign in again.", which is false.

Change section 2, step 1's real wrapper to:

```ts
{
  verifyAuthToken: async (token) => {
    let key: string;
    try {
      key = await real.getVerificationKey();
    } catch {
      throw new PrivyUnavailableError("unreachable");
    }
    return real.verifyAuthToken(token, key);
  },
  getUserById: async (id) => (await real.getUserById(id)) as unknown as { linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> },
}
```

Change step 2: if `client.verifyAuthToken` throws a `PrivyUnavailableError`, rethrow it unchanged; any other throw gives `PrivySessionError("invalid")`.

Add to test 10: a fake `verifyAuthToken` that throws `PrivyUnavailableError` gives `PrivyUnavailableError`, and test 3 already shows that maps to 503.

(Checked in the 1.32.5 tarball: `getVerificationKey(): Promise<string>` and `verifyAuthToken(token, verificationKeyOverride?)` are public; the constructor option `timeout` exists.)

## Notes, no packet change

- N1, the console contract (cs-ui ui-A2, cs-hd hd-16). With a token, the hub refuses with 403 not-your-wallet a payment that is not from one of the person's Privy-linked EVM wallets (D19). So the console sends `X-Privy-Token` on `POST /offers/:hash/call` only when the Privy wallet signs the payment, never with an injected wallet the person has not linked and never with a Hedera account. accept and dispute give 403 unless the job's buyer is the person's wallet. Fetch the token per request with `getAccessToken()`: access tokens expire after an hour and the SDK refreshes them.
- N2, the truth rule. npm marks @privy-io/server-auth deprecated ("use @privy-io/node instead"). The project lead named it, and it still verifies (jose ES256 against the app's key), so keep it tonight. The worker's report says so. Its tree brings @solana/web3.js, svix and @hpke, with peers viem ^2.24.1 (we have 2.57.16) and ethers ^6. The lock change is approved if it adds only this package's tree.
- N3, CORS. app.ts uses hono `cors({ origin: "*" })` with no allowHeaders, which reflects `Access-Control-Request-Headers`. Test 9 passes with no app.ts change, inside the lease.
- N4, the call.ts overlap with tr-01, which also inserts before any 402. Whichever lands second rebases. The packet's order holds: the Privy check first, the lineage check after.
- N5. The `claims.appId !== appId` check duplicates jose's audience check. It is harmless; keep it.
