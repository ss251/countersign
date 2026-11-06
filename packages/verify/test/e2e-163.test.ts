import { expect, test } from "bun:test";
import { slipHash, slipTypedData, type Slip, type SlipBody } from "@countersign/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifySlip } from "../src/verify.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const h = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;
const createTx = "0.0.11337064@1762440000.000000001";
const base = { network: "hedera:testnet", amount: "30000", asset: "0.0.429274", maxTimeoutSeconds: 120 };

async function slip(rail: string, accepted: Record<string, unknown>, payload: Record<string, unknown>): Promise<Slip> {
  const body = {
    v: 1, rail, network: "hedera:testnet", offerHash: h("1"), jobId: h("2"), buyer: "0.0.11337064",
    seller: seller.address, payTo: String(accepted.payTo), asset: "0.0.429274", amount: "30000",
    inputHash: h("3"), outputHash: h("4"), deliveredAt: 1762440000, children: [],
  } as unknown as SlipBody;
  const sellerSig = await seller.signTypedData(slipTypedData(body) as never);
  return {
    body, hash: slipHash(body), sellerSig,
    payment: { x402Version: 2, accepted, payload } as never,
    settlement: { transaction: createTx, network: "hedera:testnet" } as never,
  };
}

test("an exact Hedera slip verifies", async () => {
  const s = await slip("hedera", { ...base, scheme: "exact", payTo: "0.0.11337065" }, { transaction: "AAAA" });
  expect((await verifySlip(s, {})).valid).toBe(true);
});

test("a held Hedera slip is not read as an escrow countersignature (#163)", async () => {
  const s = await slip(
    "hedera-scheduled",
    { ...base, scheme: "countersign", payTo: "0.0.7000001", extra: { name: "hedera-scheduled", offerHash: h("1"), holdSeconds: 300 } },
    { scheduleId: "0.0.7000002", createTxId: createTx },
  );
  const v = await verifySlip(s, {});
  // Today: valid=false, "countersignature: the slip carries no countersignature to check".
  expect(v.findings.filter((f) => !f.ok)).toEqual([]);
  expect(v.valid).toBe(true);
});
