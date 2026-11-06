// The live proof that a held payment needs the hub: create the same held schedule the agent creates,
// then try to add the seller's signature alone, first from the payee account and then from another
// account it controls as the fee payer. The payee is a 2-of-2 of the seller and the hub, so both
// attempts are refused and the schedule never executes. The agent then logs the expired hold.
//   bun scripts/hedera/held-seller-alone.ts --offer <hash> --input <json> [hub-url]
import { ReceiptStatusError, ScheduleId, ScheduleSignTransaction, StatusError } from "@hiero-ledger/sdk";
import type { Envelope, PaymentRequirements } from "../../packages/core/src/index.ts";
import {
  createHederaAgent,
  RELEASE_MARGIN_SECONDS,
  type ScheduleHold,
} from "../../packages/buyer/src/hedera/agent.ts";
import { HubClient } from "../../packages/buyer/src/hub-client.ts";
import { createScheduledPayment } from "../../packages/buyer/src/hedera/schedule.ts";
import { HEDERA_TESTNET, MIRROR_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { mirrorFetch } from "../../packages/rail/src/hedera/mirror.ts";
import { getSchedule, secondsOf } from "../../packages/rail/src/hedera/schedule.ts";
import { key, need, readEnv, testnetClient } from "./env.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
let hub = "http://127.0.0.1:8787";
let offerHash: string | undefined;
let inputJson: string | undefined;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--offer") offerHash = args[++i] ?? die("--offer needs an offer hash");
  else if (arg === "--input") inputJson = args[++i] ?? die("--input must be JSON");
  else if (arg.startsWith("-")) die(`unknown flag ${arg}`);
  else hub = arg;
}
if (!offerHash) die("--offer <hash> is required");
if (inputJson === undefined) {
  die("--input <json> is required (the hub checks it against the offer's schema before its 402)");
}
let input: unknown;
try {
  input = JSON.parse(inputJson);
} catch {
  die("--input must be JSON");
}

function findHeldEntry(accepts: PaymentRequirements[]): PaymentRequirements {
  const held = accepts.find(
    (a) => a.network === HEDERA_TESTNET && a.scheme === "countersign" && a.extra?.name === "hedera-scheduled",
  );
  if (!held) throw new Error("the hub's 402 has no held Hedera entry");
  return held;
}

async function assertPayeeRekeyed(held: PaymentRequirements): Promise<void> {
  const path = `/api/v1/accounts/${held.payTo}`;
  let account: Record<string, unknown> = {};
  try {
    const response = await mirrorFetch(MIRROR_TESTNET + path);
    if (!response.ok) throw new Error(`mirror ${path} -> ${response.status}`);
    const body: unknown = await response.json();
    account = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    die(`could not read the payee ${held.payTo} on the mirror (${reason}). Nothing was spent.`);
  }
  const accountKey =
    typeof account.key === "object" && account.key !== null ? (account.key as Record<string, unknown>) : {};
  const hubKey = held.extra?.hubKey;
  if (
    account.receiver_sig_required !== true ||
    accountKey._type !== "ProtobufEncoded" ||
    typeof hubKey !== "string" ||
    !/^[0-9a-f]{64}$/.test(hubKey)
  ) {
    die(
      `the payee ${held.payTo} is not re-keyed to the seller and the hub yet: run scripts/hedera/held-rekey.ts first. Nothing was spent.`,
    );
  }
}

const env = readEnv();
const agentId = need(env, "HD_AGENT_ID");
const agentEvm = need(env, "HD_AGENT_EVM");
const agentKey = key(env, "HD_AGENT_KEY");
const topicId = need(env, "HD_TOPIC_ID");
const sellerId = need(env, "HD_SELLER_SIGN_ID");
const sellerKey = key(env, "HD_SELLER_SIGN_KEY");
const otherPayerId = need(env, "HD_SELLER_ID");
const otherPayerKey = key(env, "HD_SELLER_KEY");

const client = new HubClient(hub);
const listing = await client.getOffer(offerHash);
const challenge = await client.call(offerHash, input);
if (challenge.kind !== "required") throw new Error(`the hub answered ${challenge.kind}, not a 402`);
const held = findHeldEntry(challenge.required.accepts);
await assertPayeeRekeyed(held);
const holdSeconds = held.extra?.holdSeconds;
if (typeof holdSeconds !== "number") throw new Error("the held entry has no hold window");

const agentClient = testnetClient(agentId, agentKey);
const created = await createScheduledPayment(
  agentClient,
  { accountId: agentId, key: agentKey },
  {
    payTo: held.payTo,
    asset: held.asset,
    amount: BigInt(held.amount),
    offerHash,
    expiresInSeconds: holdSeconds,
  },
);

const sellerClient = testnetClient(sellerId, sellerKey);
let sellerAloneStatus = "UNKNOWN";
let sellerAloneFailed = false;
try {
  const attempt = new ScheduleSignTransaction().setScheduleId(ScheduleId.fromString(created.scheduleId));
  attempt.freezeWith(sellerClient);
  const response = await attempt.execute(sellerClient);
  const receipt = await response.getReceipt(sellerClient);
  sellerAloneStatus = receipt.status.toString();
  sellerAloneFailed = sellerAloneStatus !== "SUCCESS";
} catch (error) {
  if (error instanceof ReceiptStatusError || error instanceof StatusError) {
    sellerAloneStatus = error.status.toString();
    sellerAloneFailed = true;
  } else {
    throw error;
  }
} finally {
  sellerClient.close();
}

const otherPayerClient = testnetClient(otherPayerId, otherPayerKey);
let otherPayerStatus = "UNKNOWN";
try {
  const attempt = new ScheduleSignTransaction().setScheduleId(ScheduleId.fromString(created.scheduleId));
  attempt.freezeWith(otherPayerClient);
  await attempt.sign(sellerKey);
  const response = await attempt.execute(otherPayerClient);
  const receipt = await response.getReceipt(otherPayerClient);
  otherPayerStatus = receipt.status.toString();
} catch (error) {
  if (error instanceof ReceiptStatusError || error instanceof StatusError) {
    otherPayerStatus = error.status.toString();
  } else {
    throw error;
  }
} finally {
  otherPayerClient.close();
}

await sleep(10_000);
const schedule = await getSchedule(created.scheduleId);
if (!schedule) throw new Error(`schedule ${created.scheduleId} is not on the mirror`);
const executed = schedule.executedTimestamp !== null;
const expires = secondsOf(schedule.expirationTime);
if (expires === null) throw new Error(`schedule ${created.scheduleId} has no expiration`);

const hold: ScheduleHold = {
  scheduleId: created.scheduleId,
  createTxId: created.createTxId,
  offerHash,
  seller: listing.offer.seller,
  payTo: held.payTo,
  asset: held.asset,
  amount: held.amount,
  expiresAt: expires,
};
const agent = createHederaAgent({
  hub,
  payer: { accountId: agentId, key: agentKey },
  envelope: {
    v: 1,
    agent: agentEvm as Envelope["agent"],
    cap: held.amount,
    perMerchant: held.amount,
    allowlist: [],
    revoked: false,
  },
  topicId,
  logClient: agentClient,
});

const releaseAt = (expires + RELEASE_MARGIN_SECONDS + 1) * 1000;
await sleep(Math.max(0, releaseAt - Date.now()));
const released = await agent.releaseExpired(hold);
agentClient.close();

console.log(
  JSON.stringify(
    {
      ok: sellerAloneFailed && !executed,
      schedule: created.scheduleId,
      create: created.createTxId,
      sellerAloneStatus,
      otherPayerStatus,
      executed,
      released,
    },
    null,
    2,
  ),
);
