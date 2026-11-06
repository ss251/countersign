import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@countersign/core";
import {
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenId,
  TransactionId,
  type Transaction,
} from "@hiero-ledger/sdk";
import { buildWalletTransfer, signAndExecuteParams } from "@countersign/rail/hedera";
import {
  handleSignAndExecute,
  type ExecuteResult,
  type SignAndExecuteParams,
  type WalletAccount,
} from "../src/wallet.ts";

const PAYER = "0.0.5005";
const PAYEE = "0.0.7007";
const TOKEN = "0.0.429274";
const SECRET = "ab".repeat(32);
const OFFER_HASH = "0x" + "11".repeat(32);

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "10000",
  asset: TOKEN,
  payTo: PAYEE,
  maxTimeoutSeconds: 120,
  extra: { offerHash: OFFER_HASH },
};

const wallet: WalletAccount = { accountId: PAYER, key: PrivateKey.generateED25519() };

const RESULT: ExecuteResult = {
  transactionId: `${PAYER}@1700000000.000000001`,
  nodeId: "0.0.3",
  transactionHash: "ab".repeat(32),
};

function transferParams(payer = PAYER): SignAndExecuteParams {
  const tx = buildWalletTransfer(requirement, payer, { secret: SECRET, nodeAccountIds: ["0.0.3"] });
  return signAndExecuteParams(payer, tx);
}

describe("handleSignAndExecute", () => {
  test("signs the wallet's own transfer and returns the execution", async () => {
    const seen: Transaction[] = [];
    const answer = await handleSignAndExecute(transferParams(), wallet, async (tx) => {
      seen.push(tx);
      return RESULT;
    });

    expect(answer).toEqual(RESULT);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.getSignatures().getFlatSignatureList().length).toBeGreaterThan(0);
  });

  test("refuses another signer account", async () => {
    const params = transferParams();
    await expect(
      handleSignAndExecute(
        { signerAccountId: `hedera:testnet:${PAYEE}`, transactionList: params.transactionList },
        wallet,
        async () => RESULT,
      ),
    ).rejects.toThrow("Refused. signerAccountId");
  });

  test("refuses a transfer whose transaction id belongs to another account", async () => {
    const other = signAndExecuteParams("0.0.8008", buildWalletTransfer(requirement, "0.0.8008", {
      secret: SECRET,
      nodeAccountIds: ["0.0.3"],
    }));
    await expect(
      handleSignAndExecute(
        { signerAccountId: `hedera:testnet:${PAYER}`, transactionList: other.transactionList },
        wallet,
        async () => RESULT,
      ),
    ).rejects.toThrow("Refused. the transaction id belongs to another account.");
  });

  test("refuses anything that is not a TransferTransaction", async () => {
    const associate = new TokenAssociateTransaction()
      .setAccountId(PAYER)
      .setTokenIds([TokenId.fromString(TOKEN)])
      .setTransactionId(TransactionId.generate(AccountId.fromString(PAYER)))
      .setNodeAccountIds([AccountId.fromString("0.0.3")]);
    associate.freeze();
    const transactionList = Buffer.from(associate.toBytes()).toString("base64");

    await expect(
      handleSignAndExecute({ signerAccountId: `hedera:testnet:${PAYER}`, transactionList }, wallet, async () => RESULT),
    ).rejects.toThrow("Refused. the transaction is not a TransferTransaction.");
  });

  test("refuses malformed base64", async () => {
    await expect(
      handleSignAndExecute(
        { signerAccountId: `hedera:testnet:${PAYER}`, transactionList: "not base64 at all" },
        wallet,
        async () => RESULT,
      ),
    ).rejects.toThrow("Refused. transactionList does not decode as a Hedera transaction.");
  });
});
