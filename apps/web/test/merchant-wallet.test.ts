import { describe, expect, test } from "bun:test";
import { bpsPercent, formatGwei, type Order, type RelayStatus } from "../src/routes/merchant/model.ts";
import {
  declinedInWallet,
  refundTerms,
  refundView,
  walletRefundIsCancel,
  walletRefusal,
} from "../src/routes/merchant/wallet-refund.ts";

const MERCHANT = "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c";
const CUSTOMER = "0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298";
const JOB = "0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07";

function order(over: Partial<Order> = {}): Order {
  return {
    id: JOB,
    kind: "escrow",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "10000",
    refunded: "0",
    refundable: "10000",
    status: "held",
    createdAt: 1_800_000_000_000,
    settleTx: JOB,
    refundTxs: [],
    ...over,
  };
}

function status(payees: string[] = [MERCHANT]): RelayStatus {
  return {
    address: "0xa2EEfc657138eE5367291F8e2Ac45BAC28486006",
    balanceWei: "1",
    balanceWbt: "0.5",
    ceiling: { capWei: "1", usedWei: "0", remainingWei: "1", txCount: 0, maxTx: 200, resetsAt: 0 },
    network: "eip155:1874",
    chainId: 1874,
    policy: { maxFeePerGasWei: "50000000000", minBalanceWei: "20000000000000000", allowedPayees: payees },
  };
}

describe("which orders the connected wallet may refund", () => {
  test("this merchant's wallet, a Whitechain order, on the relayer's allowlist: it may", () => {
    expect(walletRefusal(order(), MERCHANT.toLowerCase(), status())).toBeNull();
    expect(walletRefusal(order({ kind: "exact", status: "paid" }), MERCHANT, status())).toBeNull();
    expect(walletRefusal(order({ kind: "exact", status: "partially_refunded" }), MERCHANT, status())).toBeNull();
    // An allowlist the relay does not report is not a refusal; the relay still checks.
    const unreported = status();
    delete unreported.policy?.allowedPayees;
    expect(walletRefusal(order(), MERCHANT, unreported)).toBeNull();
    expect(walletRefusal(order(), MERCHANT, { ...status(), policy: undefined })).toBeNull();
    expect(walletRefusal(order(), MERCHANT, null)).toBeNull();
  });

  test("no wallet, another merchant's wallet, another chain, or off the allowlist: a sentence, never the wallet", () => {
    expect(walletRefusal(order(), undefined, status())).toMatch(/Connect the merchant's wallet/);
    expect(walletRefusal(order(), CUSTOMER, status())).toMatch(/is not this order's merchant/);
    expect(walletRefusal(order({ network: "eip155:5042002" }), MERCHANT, status())).toMatch(/another chain/);
    expect(walletRefusal(order(), MERCHANT, status([CUSTOMER]))).toMatch(/allowlist/);
    // The relay's allowlist check is .some(): an empty list it reports allows no one.
    expect(walletRefusal(order(), MERCHANT, status([]))).toMatch(/allowlist/);
  });

  test("a cancel for an escrow the relayer does not call is refused; a direct refund does not care", () => {
    const V1 = "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4";
    const V2 = "0x55b3000000000000000000000000000000000391";
    const relayOnV2 = status();
    relayOnV2.policy = { ...relayOnV2.policy!, allowedEscrows: [V2] };
    expect(walletRefusal(order({ escrow: V1 }), MERCHANT, relayOnV2)).toMatch(/does not call this order's escrow/);
    expect(walletRefusal(order({ escrow: V2.toLowerCase() }), MERCHANT, relayOnV2)).toBeNull();
    expect(walletRefusal(order({ escrow: V1, kind: "exact", status: "paid" }), MERCHANT, relayOnV2)).toBeNull();
    // A record without its escrow is not refused here: the relay client falls back to the relay's.
    expect(walletRefusal(order(), MERCHANT, relayOnV2)).toBeNull();
  });

  test("a delivered job in its review window is refused: the escrow cancels only a job still Funded", () => {
    expect(walletRefusal(order({ status: "in_review" }), MERCHANT, status())).toMatch(/review window/);
  });

  test("an order with nothing left to refund is refused before the wallet opens", () => {
    for (const s of ["refunded", "cancelled", "pending", "refund_pending"] as const) {
      expect(walletRefusal(order({ status: s }), MERCHANT, status())).toMatch(/nothing left to refund/);
    }
  });
});

describe("what the merchant reads before signing", () => {
  test("a held escrow is a cancel for one job; a paid order is a refund of one payment", () => {
    expect(walletRefundIsCancel(order())).toBe(true);
    expect(walletRefundIsCancel(order({ status: "in_review" }))).toBe(true);
    expect(walletRefundIsCancel(order({ kind: "exact", status: "paid" }))).toBe(false);
  });

  test("the terms name the order, the customer, the amount, the chain and the job, in that order", () => {
    const terms = refundTerms(order(), 10_000n);
    expect(terms.rows.map((row) => row.label)).toEqual(["Order", "To", "Amount", "Chain", "Job"]);
    expect(terms.rows[1]?.value).toBe(CUSTOMER);
    expect(terms.rows[2]?.value).toBe("0.01 USDT");
    expect(terms.rows[3]?.value).toBe("Whitechain testnet (1874)");
    expect(terms.rows[4]?.value).toBe(JOB);
    expect(terms.signs).toMatch(/cancel for this one job/);
    expect(terms.happens).toMatch(/returns the whole USDT payment to the customer/);
  });

  test("a direct refund says it is one transfer of exactly that amount, once, for five minutes", () => {
    const terms = refundTerms(order({ kind: "exact", status: "paid" }), 2_500n);
    expect(terms.rows[4]?.label).toBe("Payment");
    expect(terms.rows[2]?.value).toBe("0.0025 USDT");
    expect(terms.signs).toMatch(/one USDT transfer of exactly this amount/);
    expect(terms.signs).toMatch(/five minutes/);
  });

  test("the relay's refund client gets the order's own fields", () => {
    expect(refundView(order({ refunded: "500" }))).toEqual({
      id: JOB,
      kind: "escrow",
      status: "held",
      customer: CUSTOMER,
      merchant: MERCHANT,
      amount: "10000",
      refunded: "500",
    });
    // The job's own escrow travels with it, so a v1 job's cancel is signed for v1.
    expect(refundView(order({ escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4" })).escrow).toBe(
      "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4",
    );
  });
});

describe("declining in the wallet is not a failure", () => {
  test("viem's rejection, EIP-1193's 4001 and the wallet's own words are all declines", () => {
    expect(declinedInWallet(Object.assign(new Error("x"), { name: "UserRejectedRequestError" }))).toBe(true);
    expect(declinedInWallet({ code: 4001 })).toBe(true);
    expect(declinedInWallet(new Error("User rejected the request."))).toBe(true);
    expect(declinedInWallet(new Error("User denied message signature"))).toBe(true);
  });

  test("anything else is a failure", () => {
    expect(declinedInWallet(new Error("network down"))).toBe(false);
    expect(declinedInWallet(null)).toBe(false);
    expect(declinedInWallet("nope")).toBe(false);
  });
});

describe("the relayer panel's figures", () => {
  test("the fee cap reads in gwei", () => {
    expect(formatGwei("50000000000")).toBe("50");
    expect(formatGwei("1500000000")).toBe("1.5");
    expect(formatGwei("1234567890")).toBe("1.23");
    expect(formatGwei("0")).toBe("0");
  });

  test("basis points read as a percentage", () => {
    expect(bpsPercent(100)).toBe("1%");
    expect(bpsPercent(250)).toBe("2.5%");
    expect(bpsPercent(10_000)).toBe("100%");
    expect(bpsPercent(5)).toBe("0.05%");
  });
});
