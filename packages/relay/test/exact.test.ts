import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { USDT } from "../src/chain.ts";
import { settleExact, verifyExact } from "../src/exact.ts";
import type { PaymentExtra, VerifyRequest } from "../src/exact.ts";
import { makeRequirements, createTestRelay, makeAuthorization, makeVerifyBody, cloneBody, NOW } from "./support.ts";

const stranger = privateKeyToAccount(generatePrivateKey());

type TestRelay = ReturnType<typeof createTestRelay>;

async function bodyFor(
  relay: TestRelay,
  options: {
    signer?: ReturnType<typeof privateKeyToAccount>;
    to?: Address;
    value?: bigint;
    amount?: bigint;
    validAfter?: bigint;
    validBefore?: bigint;
    asset?: string;
    extra?: PaymentExtra;
    payTo?: Address;
  } = {},
): Promise<VerifyRequest> {
  const payTo = options.payTo ?? relay.merchant.address;
  const amount = options.amount ?? 1_000_000n;
  const requirements = makeRequirements(payTo, amount, {
    asset: options.asset ?? USDT.address,
    extra: options.extra ?? {
      assetTransferMethod: "eip3009",
      name: "Tether USD",
      version: "1",
    },
  });
  const authorization = makeAuthorization({
    from: relay.buyer.address,
    to: options.to ?? payTo,
    value: options.value ?? amount,
    validAfter: options.validAfter,
    validBefore: options.validBefore,
  });
  return makeVerifyBody({
    signer: options.signer ?? relay.buyer,
    authorization,
    requirements,
  });
}

describe("verifyExact", () => {
  test("accepts a valid payload", async () => {
    const relay = createTestRelay();
    const result = await verifyExact(await bodyFor(relay), relay.ctx);
    expect(result).toEqual({ isValid: true, payer: relay.buyer.address });
  });

  test("invalid_payload for a bad x402 version", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    body.x402Version = 1;
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("invalid_scheme", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    body.paymentRequirements = { ...body.paymentRequirements, scheme: "upto" };
    body.paymentPayload.accepted = body.paymentRequirements;
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_scheme",
    });
  });

  test("invalid_network", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    body.paymentRequirements = { ...body.paymentRequirements, network: "eip155:1" };
    body.paymentPayload.accepted = body.paymentRequirements;
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_network",
    });
  });

  test("invalid_payload for a different asset", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { asset: "0x1111111111111111111111111111111111111111" });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("invalid_payload for a bad transfer method", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, {
      extra: { assetTransferMethod: "permit", name: "Tether USD", version: "1" },
    });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("invalid_payload for a domain name mismatch", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, {
      extra: { assetTransferMethod: "eip3009", name: "USD Coin", version: "1" },
    });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("invalid_payload when accepted does not match", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    body.paymentPayload.accepted = { ...body.paymentPayload.accepted, amount: "1" };
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("invalid_payload when the authorization cannot be parsed", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    body.paymentPayload.payload.authorization.value = "1.5";
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
  });

  test("recipient mismatch", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { to: stranger.address });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_recipient_mismatch",
    });
  });

  test("value mismatch", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { value: 900_000n });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_value_mismatch",
    });
  });

  test("authorization not active yet", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { validAfter: BigInt(NOW + 100) });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_after",
    });
  });

  test("authorization too close to expiry", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { validBefore: BigInt(NOW + 3) });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_authorization_valid_before",
    });
  });

  test("bad signature", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { signer: stranger });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_exact_evm_payload_signature",
    });
  });

  test("insufficient funds", async () => {
    const relay = createTestRelay();
    relay.chain.setBalance(relay.buyer.address, 500_000n);
    const body = await bodyFor(relay);
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "insufficient_funds",
    });
  });

  test("authorization already used", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    relay.chain.useNonce(
      relay.buyer.address,
      body.paymentPayload.payload.authorization.nonce,
    );
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_transaction_state",
    });
  });

  test("refuses an unregistered payee before the signature check", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { payTo: stranger.address });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "payee_not_registered",
    });
  });

  test("refuses an amount below the minimum", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay, { amount: 9_999n });
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "amount_below_minimum",
    });
  });

  test("simulation failure", async () => {
    const relay = createTestRelay();
    relay.chain.failSimulation = true;
    const body = await bodyFor(relay);
    expect(await verifyExact(body, relay.ctx)).toEqual({
      isValid: false,
      invalidReason: "invalid_transaction_state",
    });
  });
});

describe("settleExact", () => {
  test("settles and records the payment", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    const result = await settleExact(body, relay.ctx);
    expect(result.success).toBe(true);
    expect(result.amount).toBe("1000000");
    expect(result.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(relay.chain.writes).toHaveLength(1);
    const payment = relay.ledger.getPayment(result.transaction);
    expect(payment?.amount).toBe(1_000_000n);
    expect(payment?.payer.toLowerCase()).toBe(relay.buyer.address.toLowerCase());
    expect(payment?.payTo.toLowerCase()).toBe(relay.merchant.address.toLowerCase());
    expect(payment?.status).toBe("settled");
  });

  test("is idempotent for a settled authorization", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    const first = await settleExact(body, relay.ctx);
    const second = await settleExact(cloneBody(body), relay.ctx);
    expect(second.success).toBe(true);
    expect(second.transaction).toBe(first.transaction);
    expect(relay.chain.writes).toHaveLength(1);
  });

  test("a settle retry promotes a pending payment whose receipt landed", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    relay.chain.timeoutReceipt = true;
    const first = await settleExact(body, relay.ctx);
    expect(first.errorReason).toBe("settlement_pending");
    expect(relay.ledger.getPayment(first.transaction)?.status).toBe("pending");
    relay.chain.timeoutReceipt = false;
    relay.chain.receipts.set(first.transaction, {
      status: "success",
      blockNumber: 55n,
      gasUsed: 90_000n,
      effectiveGasPrice: 1n,
    });
    const second = await settleExact(cloneBody(body), relay.ctx);
    expect(second.success).toBe(true);
    expect(second.transaction).toBe(first.transaction);
    const payment = relay.ledger.getPayment(first.transaction);
    expect(payment?.status).toBe("settled");
    expect(payment?.blockNumber).toBe(55n);
    expect(relay.chain.writes).toHaveLength(1);
  });

  test("maps a ceiling refusal", async () => {
    const relay = createTestRelay({ capWei: 0n });
    const body = await bodyFor(relay);
    const result = await settleExact(body, relay.ctx);
    expect(result).toEqual({
      success: false,
      errorReason: "relay_ceiling_reached",
      transaction: "",
      network: "eip155:1874",
    });
    expect(relay.chain.writes).toHaveLength(0);
  });
});
