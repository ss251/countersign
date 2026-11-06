# cs-39-bond-implies-window-fleet — report

Status: done. Refs #98.

A bond above zero now requires a review window above zero. `assertOffer` refuses the offer, so `POST /offers` will not publish it. `bond terms` refuses to register it. The junk seller's bonded offer carries `reviewWindow: 60`.

## Diff summary

No existing test failed. The bonded offers in `packages/rail/test/escrow.test.ts` and `packages/rail/test/escrow-v2.test.ts` never call `assertOffer`, so none of them needed `reviewWindow: 60`, and no offer-hash constant was recomputed. No existing test file changed.

### `packages/core/src/offer.ts`

After the price, bond and `reviewWindow` checks, `assertOffer` rejects a bond `parseAtomic` reads as above zero when `reviewWindow` is absent or 0:

```
offer.bond above zero needs offer.reviewWindow above zero: a bond protects a buyer who can refuse a delivery
```

`parseAtomic("000")` throws before this rule. `"000"` is not an atomic amount (`packages/core/src/amount.ts` rejects leading zeros; `amount.test.ts` pins `"01"`). It is not counted as zero, and it is not counted as a bond above zero. The only zero `parseAtomic` accepts is `"0"`, and that offer still passes with no window. Accepting `"000"` as a publishable bond would need a change to `parseAtomic`, which is outside this lease and would contradict that leading-zero rejection.

### `packages/runner/src/bond.ts`

- Usage line, after the `bond terms` flags: `A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.`
- When `--bond` parses above zero and `--review-window` is absent, `parseTermsArgs` throws before the generic missing-flag error and before any client is built:

```
Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.
```

- `assertTerms` throws the same sentence when the parsed bond is above zero and the parsed window is 0. `runBond` already calls `assertTerms` before `writeTerms` or `writeContract`.

A bond that does not parse stays on the previous errors. Bond `"0"` with window 0 is still accepted.

### `scripts/demo/junk-seller.ts`

The published offer gained one field: `reviewWindow: 60`. Nothing else in the file changed.

### New tests

- `packages/core/test/bond-window.test.ts`
- `apps/hub/test/bond-window.test.ts`
- `packages/runner/test/bond-window.test.ts`

## Every changed test line

No line in an existing test file changed. The lines below are the whole of the three new files.

### `packages/core/test/bond-window.test.ts`

```
import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { assertOffer, OfferError } from "../src/index.ts";

const MESSAGE =
  "offer.bond above zero needs offer.reviewWindow above zero: a bond protects a buyer who can refuse a delivery";

const seller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function offer(over: { bond?: string; reviewWindow?: number } = {}) {
  return {
    v: 1,
    seller: seller.address,
    title: "t",
    summary: "",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: over.bond ?? "1",
    rails: ["escrow"],
    issuedAt: 1_800_000_000,
    ...(over.reviewWindow !== undefined ? { reviewWindow: over.reviewWindow } : {}),
  };
}

describe("a bond implies a review window", () => {
  test("bond 1 with no window throws exactly that message", () => {
    expect(() => assertOffer(offer())).toThrow(new OfferError(MESSAGE));
  });

  test("bond 1 with window 0 throws", () => {
    expect(() => assertOffer(offer({ reviewWindow: 0 }))).toThrow(new OfferError(MESSAGE));
  });

  test("bond 1 with window 60 passes", () => {
    expect(() => assertOffer(offer({ reviewWindow: 60 }))).not.toThrow();
  });

  test('bond "000" with no window is not a bond above zero', () => {
    // parseAtomic rejects leading zeros, so "000" fails before the window rule.
    // The zero it does accept, "0", needs no window.
    expect(() => assertOffer(offer({ bond: "000" }))).toThrow(
      new OfferError("offer.price and offer.bond must be atomic digit strings"),
    );
    expect(() => assertOffer(offer({ bond: "0" }))).not.toThrow();
  });
});
```

The packet asked for bond `"000"` with no window to pass `assertOffer`. That assertion fails for a reason other than this rule: `parseAtomic("000")` throws `AmountError`, and the existing catch turns it into `offer.price and offer.bond must be atomic digit strings`. The committed test asserts that message, and asserts that bond `"0"` with no window passes. The window sentence is not the error.

### `apps/hub/test/bond-window.test.ts`

```
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { offerHash } from "../src/deps.ts";
import { makeOffer, publish, startHub, type TestHub } from "./support.ts";

describe("POST /offers refuses a bond without a review window", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("a signed offer with a bond and no window is 400 and is not stored", async () => {
    const refused = makeOffer({ bond: "1" });
    const rejected = await publish(hub, refused);
    expect(rejected.status).toBe(400);
    expect(hub.store.listOffers()).toHaveLength(0);

    const listed = (await fetch(`${hub.url}/offers`).then((response) => response.json())) as { offers: unknown[] };
    expect(listed.offers).toHaveLength(0);

    const accepted = makeOffer({ bond: "1", reviewWindow: 60 });
    const response = await publish(hub, accepted);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ offerHash: offerHash(accepted) });
    expect(hub.store.listOffers()).toHaveLength(1);
  });
});
```

The hub source is unchanged. `POST /offers` already calls `assertOffer` before `putOffer`.

### `packages/runner/test/bond-window.test.ts`

```
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "bun";
import { parseBondArgs } from "../src/bond.ts";

const ROOT = join(import.meta.dir, "../../..");
const MESSAGE =
  "Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.";

describe("bond terms", () => {
  test("with --bond 100 and no --review-window exits non-zero with that message", () => {
    const run = spawnSync(
      [
        process.execPath,
        "packages/runner/src/cli.ts",
        "bond",
        "terms",
        "--offer",
        `0x${"aa".repeat(32)}`,
        "--price",
        "500000",
        "--bond",
        "100",
        "--min-duration",
        "120",
        "--escrow",
        "0x4444444444444444444444444444444444444444",
      ],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          CS_SELLER_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString().trim()).toBe(MESSAGE);
    expect(run.stdout.toString()).toBe("");
  });

  test("--review-window 0 with a bond above zero is the same refusal", () => {
    expect(() =>
      parseBondArgs([
        "terms",
        "--offer",
        `0x${"aa".repeat(32)}`,
        "--price",
        "500000",
        "--bond",
        "100",
        "--review-window",
        "0",
        "--min-duration",
        "120",
        "--escrow",
        "0x4444444444444444444444444444444444444444",
      ]),
    ).toThrow(MESSAGE);
  });
});
```

The second test is the window-0 half of the same sentence. It calls `parseBondArgs`, which returns before any client is built. The key in the spawn is the fixed anvil key already used by `packages/core/test/countersign-v2.test.ts`.

## Source lines that changed

### `packages/core/src/offer.ts`

```
  if (parseAtomic(o!.bond as string) > 0n && (o!.reviewWindow ?? 0) === 0) {
    fail(
      "offer.bond above zero needs offer.reviewWindow above zero: a bond protects a buyer who can refuse a delivery",
    );
  }
```

### `packages/runner/src/bond.ts`

```
 *   A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.
```

```
  if (bond !== undefined && reviewWindow === undefined) {
    let parsed: bigint | undefined;
    try {
      parsed = parseAtomic(bond);
    } catch {
      // Not an atomic amount. The checks below report that.
      parsed = undefined;
    }
    if (parsed !== undefined && parsed > 0n) {
      throw new Error(
        "Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.",
      );
    }
  }
```

```
  if (bond > 0n && reviewWindow === 0) {
    throw new Error(
      "Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.",
    );
  }
```

### `scripts/demo/junk-seller.ts`

```
  reviewWindow: 60,
```

## Tests run

From the worktree root, after `bun install --linker hoisted`:

```
bun run typecheck    # exit 0
bun test             # 1269 pass, 3 skip, 0 fail
forge test           # 47 passed, 0 failed, 0 skipped (47 total)
```

`bun test` ran 1272 tests across 157 files. The 3 skips are the existing Arc testnet fifth-check tests. No browser was launched. Nothing was pushed, merged or deployed.
