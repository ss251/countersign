import { describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  AccountUpdateTransaction,
  Hbar,
  NftId,
  PrivateKey,
  Timestamp,
  TokenAssociateTransaction,
  TokenId,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { keccak256 } from "viem";
import { USDC_TESTNET } from "../constants.ts";
import { offerMemo } from "../memo.ts";
import {
  signPrivyTransfer,
  validatePrivyTransfer,
  type PrivyTransferTerms,
} from "../privy-signer.ts";

const NOW = 1_700_000_000;
const BUYER = "0.0.7001";
const PAYEE = "0.0.7002";
const FEE_PAYER = "0.0.9185802";
const OTHER = "0.0.7003";
const OFFER_HASH = `0x${"ab".repeat(32)}`;
const NODE = AccountId.fromString("0.0.3");
const NODE_TWO = AccountId.fromString("0.0.4");
const AMOUNT = 10_000n;

function terms(over: Partial<PrivyTransferTerms> = {}): PrivyTransferTerms {
  return {
    accountId: BUYER,
    asset: USDC_TESTNET,
    amount: AMOUNT,
    payTo: PAYEE,
    feePayer: FEE_PAYER,
    offerHash: OFFER_HASH,
    cap: 1_000_000n,
    ...over,
  };
}

interface Build {
  from?: string;
  to?: string;
  amount?: bigint;
  asset?: string;
  feePayer?: string;
  payer?: string;
  memo?: string;
  hbar?: boolean;
  nft?: boolean;
  approved?: boolean;
  decimals?: number;
  secondToken?: boolean;
  extraEntry?: boolean;
  validStart?: number;
  duration?: number;
  scheduled?: boolean;
  nonce?: number;
  nodes?: AccountId[];
}

function build(b: Build = {}): string {
  const asset = b.asset ?? USDC_TESTNET;
  const amount = b.amount ?? AMOUNT;
  const tx = new TransferTransaction();
  if (b.nft) {
    tx.addNftTransfer(new NftId(TokenId.fromString(asset), 1), b.from ?? BUYER, b.to ?? PAYEE);
  } else if (b.approved) {
    tx.addApprovedTokenTransfer(asset, b.from ?? BUYER, -amount);
    tx.addTokenTransfer(asset, b.to ?? PAYEE, amount);
  } else if (b.decimals !== undefined) {
    tx.addTokenTransferWithDecimals(asset, b.from ?? BUYER, -amount, b.decimals);
    tx.addTokenTransferWithDecimals(asset, b.to ?? PAYEE, amount, b.decimals);
  } else {
    tx.addTokenTransfer(asset, b.from ?? BUYER, -amount);
    tx.addTokenTransfer(asset, b.to ?? PAYEE, amount);
  }
  if (b.secondToken) {
    tx.addTokenTransfer("0.0.999999", b.from ?? BUYER, -1);
    tx.addTokenTransfer("0.0.999999", b.to ?? PAYEE, 1);
  }
  if (b.extraEntry) {
    tx.addTokenTransfer(asset, OTHER, -1);
    tx.addTokenTransfer(asset, b.to ?? PAYEE, 1);
  }
  if (b.hbar) {
    tx.addHbarTransfer(b.from ?? BUYER, Hbar.fromTinybars(-1));
    tx.addHbarTransfer(b.to ?? PAYEE, Hbar.fromTinybars(1));
  }
  const id = TransactionId.withValidStart(
    AccountId.fromString(b.payer ?? b.feePayer ?? FEE_PAYER),
    Timestamp.fromDate(new Date((b.validStart ?? NOW) * 1000)),
  );
  if (b.scheduled) id.setScheduled(true);
  if (b.nonce !== undefined) id.setNonce(b.nonce);
  tx.setTransactionId(id)
    .setTransactionMemo(b.memo ?? offerMemo(OFFER_HASH))
    .setTransactionValidDuration(b.duration ?? 120)
    .setNodeAccountIds(b.nodes ?? [NODE])
    .freeze();
  return Buffer.from(tx.toBytes()).toString("base64");
}

function frozenOther(kind: "update" | "approve" | "associate"): string {
  const id = TransactionId.withValidStart(AccountId.fromString(FEE_PAYER), Timestamp.fromDate(new Date(NOW * 1000)));
  const tx =
    kind === "update"
      ? new AccountUpdateTransaction().setAccountId(BUYER)
      : kind === "approve"
        ? new AccountAllowanceApproveTransaction().approveTokenAllowance(USDC_TESTNET, BUYER, PAYEE, 1)
        : new TokenAssociateTransaction().setAccountId(BUYER).setTokenIds([USDC_TESTNET]);
  tx.setTransactionId(id).setNodeAccountIds([NODE]).freeze();
  return Buffer.from(tx.toBytes()).toString("base64");
}

async function signedBuild(): Promise<string> {
  const tx = Transaction.fromBytes(Buffer.from(build(), "base64"));
  await tx.sign(PrivateKey.generateECDSA());
  return Buffer.from(tx.toBytes()).toString("base64");
}

function reason(bytes: string, expected: PrivyTransferTerms = terms()): string {
  const check = validatePrivyTransfer(bytes, expected, NOW);
  if (check.ok) throw new Error("expected a refusal");
  return check.reason;
}

describe("validatePrivyTransfer", () => {
  test("the hub's own transfer passes and returns the parsed transaction", () => {
    const check = validatePrivyTransfer(build(), terms(), NOW);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.tx.transactionId?.toString()).toBe(`${FEE_PAYER}@${NOW}.000000000`);
  });

  test("H1: only a TransferTransaction is accepted", () => {
    expect(reason("not base64")).toBe("malformed");
    expect(reason(frozenOther("update"))).toBe("not-transfer");
    expect(reason(frozenOther("approve"))).toBe("not-transfer");
    expect(reason(frozenOther("associate"))).toBe("not-transfer");
  });

  test("a transfer carrying any client signature is refused", async () => {
    expect(reason(await signedBuild())).toBe("signed");
  });

  test("H2: every node body must agree apart from its node", () => {
    const raw = Buffer.from(build({ nodes: [NODE, NODE_TWO] }), "base64");
    const list = proto.TransactionList.decode(raw).transactionList;
    const second = proto.SignedTransaction.decode(list[1]!.signedTransactionBytes!) as proto.SignedTransaction;
    const body = proto.TransactionBody.decode(second.bodyBytes!) as proto.TransactionBody;
    const transfer = body.cryptoTransfer as proto.CryptoTransferTransactionBody;
  const transferList = transfer.tokenTransfers[0] as proto.TokenTransferList;
  const entry = transferList.transfers![0] as proto.AccountAmount;
  entry.isApproval = true;
    second.bodyBytes = proto.TransactionBody.encode(body).finish();
    list[1] = { signedTransactionBytes: proto.SignedTransaction.encode(second).finish() };
    const crafted = Buffer.from(proto.TransactionList.encode({ transactionList: list }).finish()).toString("base64");
    expect(reason(crafted)).toBe("body-mismatch");
  });

  test("H3: exactly the offer's asset, amount and payee, and nothing else", () => {
    expect(reason(build({ asset: "0.0.999999" }))).toBe("wrong-asset");
    expect(reason(build({ secondToken: true }))).toBe("extra-tokens");
    expect(reason(build({ nft: true }))).toBe("nft-transfers");
    expect(reason(build({ hbar: true }))).toBe("hbar-transfers");
    expect(reason(build({ approved: true }))).toBe("approval");
    expect(reason(build({ decimals: 8 }))).toBe("decimals");
    expect(reason(build({ to: OTHER }))).toBe("wrong-payee");
    expect(reason(build({ amount: 9_999n }))).toBe("amount-mismatch");
    expect(reason(build({ from: OTHER }))).toBe("wrong-payer-account");
    expect(reason(build({ extraEntry: true }))).toBe("wrong-transfer-entries");
  });

  test("H4: the fee payer, validity window, schedule and nonce", () => {
    expect(reason(build({ payer: BUYER }))).toBe("wrong-fee-payer");
    expect(reason(build({ validStart: NOW - 60 }))).toBe("expired");
    expect(reason(build({ validStart: NOW + 60 }))).toBe("not-yet-valid");
    expect(reason(build({ duration: 181 }))).toBe("validity-too-long");
    expect(reason(build({ scheduled: true }))).toBe("scheduled");
    expect(reason(build({ nonce: 1 }))).toBe("nonce");
  });

  test("H5: the memo names this offer and the amount is inside the cap", () => {
    expect(reason(build({ memo: offerMemo(`0x${"cd".repeat(32)}`) }))).toBe("wrong-memo");
    expect(reason(build({ memo: "cs1:short" }))).toBe("wrong-memo");
    expect(reason(build({ amount: 1_000_001n }), terms({ amount: 1_000_001n }))).toBe("over-cap");
    expect(reason(build(), terms({ cap: 5_000n }))).toBe("over-cap");
  });
});

describe("signPrivyTransfer", () => {
  test("signs every node body through the callback and leaves the bodies alone", async () => {
    const key = PrivateKey.generateECDSA();
    const raw = build({ nodes: [NODE, NODE_TWO] });
    const check = validatePrivyTransfer(raw, terms(), NOW);
    if (!check.ok) throw new Error(check.reason);
    const seen: Uint8Array[] = [];
    const signed = await signPrivyTransfer(check.tx, {
      publicKey: key.publicKey.toStringRaw(),
      sign: async (bodyBytes) => {
        seen.push(bodyBytes);
        return key.sign(bodyBytes);
      },
    });
    expect(seen).toHaveLength(2);
    const back = TransferTransaction.fromBytes(signed.toBytes());
    const bodies = (back as unknown as { _signedTransactions: { list: proto.SignedTransaction[] } })
      ._signedTransactions.list;
    expect(bodies).toHaveLength(2);
    for (const [index, entry] of bodies.entries()) {
      expect(Buffer.from(entry.bodyBytes!)).toEqual(Buffer.from(seen[index]!));
      const pairs = entry.sigMap?.sigPair ?? [];
      expect(pairs).toHaveLength(1);
      const signature = pairs[0]!.ECDSASecp256k1!;
      expect(Buffer.from(pairs[0]!.pubKeyPrefix!)).toEqual(Buffer.from(key.publicKey.toBytesRaw()));
      expect(key.publicKey.verify(seen[index]!, signature)).toBe(true);
      expect(keccak256(seen[index]!)).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
