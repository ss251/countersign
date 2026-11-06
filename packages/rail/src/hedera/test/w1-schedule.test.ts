import { describe, expect, test } from "bun:test";
import { AccountId, ScheduleCreateTransaction, Timestamp, TokenId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import { offerMemo } from "../memo.ts";
import { inspectScheduled } from "../schedule.ts";
import { NODE, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

// cs-w1 adversarial tests. A failing test here is a blocker.
// The seller adds its signature to a schedule after reading the body with a hand-written decoder.
// Protobuf lets a body carry two members of its `data` oneof; the network keeps the LAST one. A
// decoder that reads the first benign transfer and ignores the rest approves a body that executes
// something else once the seller's key has signed.

function fields(bytes: Uint8Array): { no: number; wire: number; start: number; end: number }[] {
  const out: { no: number; wire: number; start: number; end: number }[] = [];
  let i = 0;
  const varint = (): number => {
    let v = 0;
    let s = 0;
    for (;;) {
      const b = bytes[i++]!;
      v |= (b & 0x7f) << s;
      if ((b & 0x80) === 0) return v;
      s += 7;
    }
  };
  while (i < bytes.length) {
    const start = i;
    const key = varint();
    const no = key >> 3;
    const wire = key & 7;
    if (wire === 0) varint();
    else if (wire === 2) {
      const len = varint();
      i += len;
    }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    out.push({ no, wire, start, end: i });
  }
  return out;
}
const sub = (bytes: Uint8Array, no: number): Uint8Array => {
  const f = fields(bytes).find((x) => x.no === no)!;
  let i = f.start;
  while ((bytes[i]! & 0x80) !== 0) i++;
  i++; // key
  let len = 0;
  let s = 0;
  for (;;) {
    const b = bytes[i++]!;
    len |= (b & 0x7f) << s;
    if ((b & 0x80) === 0) break;
    s += 7;
  }
  return bytes.subarray(i, i + len);
};

function benignBody(): Uint8Array {
  const asset = TokenId.fromString(USDC_TESTNET);
  const inner = new TransferTransaction()
    .addTokenTransfer(asset, AccountId.fromString(PAYER), -10000n)
    .addTokenTransfer(asset, AccountId.fromString(PAYEE), 10000n)
    .setTransactionMemo(offerMemo(OFFER_HASH));
  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(offerMemo(OFFER_HASH))
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 300_000)))
    .setTransactionId(TransactionId.generate(AccountId.fromString(PAYER)))
    .setNodeAccountIds([NODE])
    .freeze();
  const list = sub(create.toBytes(), 1);
  const tx = sub(list, 5);
  const signed = sub(tx, 1);
  const scheduleCreate = sub(signed, 42);
  return sub(scheduleCreate, 1);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const field = (no: number, payload: Uint8Array) => Uint8Array.from([(no << 3) | 2, payload.length, ...payload]);

describe("W1 B11: the seller's pre-sign decoder ignores what it does not recognise", () => {
  test("the benign body is accepted", () => {
    expect(inspectScheduled(b64(benignBody())).tokens[USDC_TESTNET]).toHaveLength(2);
  });

  test("a body with a second data member after the benign transfer is refused", () => {
    // Field 15 is another member of the same oneof. The network executes the last data member.
    const body = benignBody();
    const crafted = Uint8Array.from([...body, ...field(15, Uint8Array.from([0x0a, 0x00]))]);
    expect(() => inspectScheduled(b64(crafted))).toThrow();
  });

  test("a body that repeats the transfer member with other contents is refused", () => {
    // Two field-9 members: protobuf keeps the last, the decoder reads the first.
    const body = benignBody();
    const first = sub(body, 9);
    const crafted = Uint8Array.from([...body, ...field(9, first)]);
    expect(() => inspectScheduled(b64(crafted))).toThrow();
  });
});
