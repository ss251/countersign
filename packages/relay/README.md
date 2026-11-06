# @countersign/relay

## Install (v0.1.0, from the GitHub release)

One command installs the relay. Its manifest brings core and rail from the same release:

```
bun add https://github.com/ss251/countersign/releases/download/v0.1.0/countersign-relay-0.1.0.tgz
```

`@countersign/relay/paywall`:

```ts
import { whitechainPaywall } from "@countersign/relay/paywall";
```

`@countersign/relay/pay-fetch`:

```ts
import { createPayFetch } from "@countersign/relay/pay-fetch";
```

The packages ship TypeScript source for Bun or a TypeScript-aware bundler, they are not on npm, and Node without a bundler is not supported in 0.1.0.
