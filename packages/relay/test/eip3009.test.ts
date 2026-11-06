import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  PayloadError,
  authorizationFromWire,
  authorizationToWire,
  recoverAuthorizer,
  signAuthorization,
} from "../src/eip3009.ts";
import type { WireAuthorization } from "../src/eip3009.ts";
import { NOW, makeAuthorization } from "./support.ts";

const buyer = privateKeyToAccount(generatePrivateKey());
const merchant = privateKeyToAccount(generatePrivateKey());

function wire(): WireAuthorization {
  return authorizationToWire(
    makeAuthorization({
      from: buyer.address,
      to: merchant.address,
      value: 1_500_000n,
      validAfter: 10n,
      validBefore: BigInt(NOW + 600),
    }),
  );
}

describe("EIP-3009 authorization", () => {
  test("signs and recovers the authorizer", async () => {
    const auth = authorizationFromWire(wire());
    const signature = await signAuthorization(buyer, auth);
    expect((await recoverAuthorizer(auth, signature)).toLowerCase()).toBe(
      buyer.address.toLowerCase(),
    );
  });

  test("round-trips the wire form", () => {
    const original = wire();
    expect(authorizationToWire(authorizationFromWire(original))).toEqual(original);
  });

  test("rejects a non-digit value", () => {
    const bad = wire();
    bad.value = "1.5";
    expect(() => authorizationFromWire(bad)).toThrow(PayloadError);
  });

  test("rejects a short nonce", () => {
    const bad = wire();
    bad.nonce = "0x1234";
    expect(() => authorizationFromWire(bad)).toThrow(PayloadError);
  });

  test("rejects a bad address", () => {
    const bad = wire();
    bad.from = "0xnot-an-address";
    expect(() => authorizationFromWire(bad)).toThrow(PayloadError);
  });
});
