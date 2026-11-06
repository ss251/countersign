import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { authorizationTypedData, countersignPayload, jobIdOf, offerHash } from "@countersign/core";
import type { CountersignExtra, Offer } from "@countersign/core";
import { whitechainEscrowConfig, whitechainRailFor } from "../src/whitechain-config.ts";
import type { CountersignContext } from "../src/countersign-scheme.ts";
import { NOW, createTestRelay } from "./support.ts";

export type TestRelay = ReturnType<typeof createTestRelay>;

export function csContext(relay: TestRelay): CountersignContext {
  return {
    chainClient: relay.chain,
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
  };
}

export function makeOffer(seller: Address): Offer {
  return {
    v: 1,
    seller,
    title: "test offer",
    summary: "",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price: "1500000",
    deadline: 120,
    bond: "0",
    rails: ["whitechain"],
    issuedAt: 1,
  };
}

let saltCounter = 0;

/** A valid countersign body for the relay, signed by a fresh throwaway buyer. */
export async function makeCountersignBody(relay: TestRelay, price?: string) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer = makeOffer(relay.merchant.address);
  const rail = whitechainRailFor();
  const req = rail.challenge(offer, { resource: "http://merchant.example/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra;
  saltCounter += 1;
  const input = {
    terms: {
      offerHash: offerHash(offer),
      buyer: buyer.address,
      payee: getAddress(req.payTo),
      amount: price ?? req.amount,
      deadline: NOW + extra.deadlineSeconds,
      salt: String(saltCounter),
    },
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: getAddress(req.asset),
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const jobId: Hex = jobIdOf(input.terms, extra.chainId, extra.escrow);
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: req,
      payload: payload as unknown as Record<string, unknown>,
      resource: { url: "http://merchant.example/x" },
    },
    paymentRequirements: req,
  };
  return { body, buyer, jobId, req, extra, escrow: whitechainEscrowConfig().escrow };
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
