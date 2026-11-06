import { describe, expect, test } from "bun:test";
import { authorizationTypedData, type PaymentRequirements } from "@countersign/core";
import { ARC_PIN } from "../src/lib/arc-pin.ts";
import { buildAuthorization, trustedRequirement } from "../src/lib/purchase.ts";

const buyer = "0x8c1f9e2b7d6a5f4e3c2b1a09f8e7d6c5b4a3a20b" as const;
const payee = "0x196768E381490a9849d44bd8427784e9fD3aCd07" as const;
const offerHash = "0xb1eef1aa59e096cb27fd4a7d3ab2531f7fddfd73bc39de5411fcde0f594e2a20" as const;
const salt = `0x${"11".repeat(32)}`;
const saltDecimal = BigInt(salt).toString(10);
const now = 1_793_958_047;

function requirement(escrow: string = ARC_PIN.escrow): PaymentRequirements {
  return {
    scheme: "countersign",
    network: "eip155:5042002",
    amount: "50000",
    asset: ARC_PIN.token,
    payTo: payee,
    maxTimeoutSeconds: 120,
    extra: {
      rail: "escrow",
      escrow,
      chainId: ARC_PIN.chainId,
      offerHash,
      deadlineSeconds: 60,
      tokenName: ARC_PIN.tokenName,
      tokenVersion: ARC_PIN.tokenVersion,
    },
  };
}

describe("buildAuthorization", () => {
  test("signs the pin's escrow and token over the hub's own terms", () => {
    expect(buildAuthorization(requirement(), buyer, now, salt)).toEqual({
      terms: {
        offerHash,
        buyer,
        payee,
        amount: "50000",
        deadline: now + 60,
        salt: saltDecimal,
      },
      chainId: 5042002,
      escrow: ARC_PIN.escrow,
      token: ARC_PIN.token,
      tokenName: "USDC",
      tokenVersion: "2",
      validAfter: 0,
      validBefore: now + 600,
    });
  });

  test("the typed data is exactly what core builds for the same terms", () => {
    const expected = authorizationTypedData({
      terms: {
        offerHash,
        buyer,
        payee,
        amount: "50000",
        deadline: now + 60,
        salt: saltDecimal,
      },
      chainId: ARC_PIN.chainId,
      escrow: ARC_PIN.escrow,
      token: ARC_PIN.token,
      tokenName: ARC_PIN.tokenName,
      tokenVersion: ARC_PIN.tokenVersion,
      validAfter: 0,
      validBefore: now + 600,
    });
    expect(authorizationTypedData(buildAuthorization(requirement(), buyer, now, salt))).toEqual(expected);
  });
});

describe("trustedRequirement", () => {
  test("accepts the Arc countersign terms whose escrow is the pin's", () => {
    const choice = trustedRequirement([requirement()]);
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.req).toEqual(requirement());
  });

  test("refuses a requirement naming another escrow", () => {
    expect(trustedRequirement([requirement("0x44d11b8909485e3f575F6628b689383E4420f54a")])).toEqual({
      ok: false,
      message: "The hub's terms name an escrow this page does not trust, so nothing was signed.",
    });
  });

  test("refuses when no Arc countersign terms is offered", () => {
    expect(
      trustedRequirement([
        {
          ...requirement(),
          scheme: "exact",
        },
      ]),
    ).toEqual({
      ok: false,
      message: "This hub offered no Arc countersign terms for this offer.",
    });
  });
});
