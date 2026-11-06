import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { assertOffer, checkEnsLock, ensLockProblem, isEnsName, sepoliaEnsResolver, type Offer } from "../src/index.ts";

const SELLER: Address = "0x1111111111111111111111111111111111111111";
const OTHER: Address = "0x2222222222222222222222222222222222222222";

const offer = (over: Partial<Offer> = {}): Offer => ({
  v: 1,
  seller: SELLER,
  title: "Echo",
  summary: "echoes",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1000",
  deadline: 60,
  bond: "0",
  rails: ["escrow", "hedera"],
  ens: "alice.eth",
  issuedAt: 1,
  ...over,
});

describe("isEnsName", () => {
  test("takes names already in normal form", () => {
    for (const name of ["alice.eth", "pay.alice.eth", "a-b.eth", "😀.eth"]) expect(isEnsName(name)).toBe(true);
  });

  test("refuses names that are not normal, have one label, or are not strings", () => {
    for (const name of ["Alice.eth", "alice", "alice..eth", ".eth", "", " alice.eth", "al ice.eth", 7, null]) {
      expect(isEnsName(name)).toBe(false);
    }
    expect(isEnsName(`${"a".repeat(252)}.eth`)).toBe(false);
  });

  test("assertOffer refuses an offer whose ens is not a normal name", () => {
    expect(() => assertOffer(offer())).not.toThrow();
    expect(() => assertOffer(offer({ ens: "Alice.eth" }))).toThrow("offer.ens");
  });
});

describe("ensLockProblem", () => {
  test("holds when the name resolves to the seller and EVM payees are the seller", () => {
    expect(ensLockProblem(offer({ payTo: { escrow: SELLER.toUpperCase().replace("0X", "0x"), hedera: "0.0.5" } }), SELLER)).toBeUndefined();
  });

  test("breaks when the name resolves to someone else", () => {
    expect(ensLockProblem(offer(), OTHER)).toContain("not to the offer's seller");
  });

  test("breaks when an EVM payee is not the name's address; a Hedera account is outside the lock", () => {
    expect(ensLockProblem(offer({ payTo: { gateway: OTHER } }), SELLER)).toContain("gateway payee");
    expect(ensLockProblem(offer({ payTo: { hedera: "0.0.999" } }), SELLER)).toBeUndefined();
  });
});

describe("checkEnsLock", () => {
  test("an offer with no name needs no lookup", async () => {
    const { ens: _, ...plain } = offer();
    expect(await checkEnsLock(plain, undefined)).toBeNull();
  });

  test("resolves to the seller", async () => {
    expect(await checkEnsLock(offer(), async () => SELLER)).toEqual({ ok: true, address: SELLER });
  });

  test("refuses a mismatch, an unresolved name, a failed lookup and a missing resolver", async () => {
    expect(await checkEnsLock(offer(), async () => OTHER)).toMatchObject({ ok: false, code: "ens-mismatch" });
    expect(await checkEnsLock(offer(), async () => null)).toMatchObject({ ok: false, code: "ens-unresolved" });
    const down = async (): Promise<Address | null> => {
      throw new Error("rpc down");
    };
    expect(await checkEnsLock(offer(), down)).toMatchObject({ ok: false, code: "ens-unavailable" });
    expect(await checkEnsLock(offer(), undefined)).toMatchObject({ ok: false, code: "ens-unavailable" });
  });
});

describe("sepoliaEnsResolver", () => {
  test("reuses an answer inside the cache window, then asks again", async () => {
    let calls = 0;
    let at = 0;
    const resolve = sepoliaEnsResolver({ cacheMs: 1000, now: () => at, lookup: async () => (calls++, SELLER) });
    expect(await resolve("alice.eth")).toBe(SELLER);
    expect(await resolve("alice.eth")).toBe(SELLER);
    expect(calls).toBe(1);
    at = 1000;
    await resolve("alice.eth");
    expect(calls).toBe(2);
  });

  test("does not cache a failed lookup", async () => {
    let calls = 0;
    const resolve = sepoliaEnsResolver({
      lookup: async () => {
        calls++;
        if (calls === 1) throw new Error("rpc down");
        return null;
      },
    });
    await expect(resolve("alice.eth")).rejects.toThrow("rpc down");
    expect(await resolve("alice.eth")).toBeNull();
    expect(calls).toBe(2);
  });
});
