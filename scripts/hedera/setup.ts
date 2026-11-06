// Hedera testnet setup for the hedera rail. Idempotent: every step checks before it acts.
//   bun scripts/hedera/setup.ts
// 1. finds the operator account the faucet created for HD_OPERATOR_EVM
// 2. creates the agent, seller and seller-sign accounts (ECDSA key with EVM alias) unless they already exist
// 3. associates testnet USDC with the agent, the seller and the seller-sign account
// 4. creates the spend-log topic: no admin key, so it cannot be changed or deleted; submit key = agent
import {
  AccountCreateTransaction,
  Hbar,
  ReceiptStatusError,
  Status,
  StatusError,
  TokenAssociateTransaction,
  TopicCreateTransaction,
} from "../../packages/rail/src/hedera/sdk.ts";
import { USDC_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { hbarBalance, resolveAccount, tokenBalance } from "../../packages/rail/src/hedera/mirror.ts";
import { hashscanAccount, hashscanTopic } from "../../packages/rail/src/hedera/txid.ts";
import { key, need, readEnv, testnetClient, writeEnv } from "./env.ts";

const env = readEnv();
const opKey = key(env, "HD_OPERATOR_KEY");
const opEvm = need(env, "HD_OPERATOR_EVM");

const opId = env.HD_OPERATOR_ID ?? (await resolveAccount(opEvm));
if (!opId) {
  console.log(`operator not funded yet: send testnet HBAR to ${opEvm}`);
  process.exit(2);
}
writeEnv({ HD_OPERATOR_ID: opId });
const op = testnetClient(opId, opKey);

// Seed balances scale with what the faucet gave: 10 HBAR anonymous, up to 100 signed in.
const opBalance = await hbarBalance(opId);
const seed = {
  AGENT: Hbar.fromTinybars(((opBalance * 30n) / 100n).toString()),
  SELLER: Hbar.fromTinybars(((opBalance * 10n) / 100n).toString()),
  // Enough for ScheduleSign fees only, not a spending balance. The operator pays every USDC
  // association below, so this seed is not needed for the association's ~0.72 HBAR fee.
  SELLER_SIGN: Hbar.fromTinybars("30000000"),
};

const ids = { AGENT: "", SELLER: "", SELLER_SIGN: "" };
for (const role of ["AGENT", "SELLER", "SELLER_SIGN"] as const) {
  const k = key(env, `HD_${role}_KEY`);
  let id = env[`HD_${role}_ID`] ?? (await resolveAccount(need(env, `HD_${role}_EVM`)));
  if (!id) {
    const create = new AccountCreateTransaction().setECDSAKeyWithAlias(k.publicKey).setInitialBalance(seed[role]);
    // The seller-sign account must sign for every transfer in, so a scheduled credit cannot run
    // until its key lands on the schedule.
    if (role === "SELLER_SIGN") create.setReceiverSignatureRequired(true);
    const tx = await create.freezeWith(op).sign(k);
    const receipt = await (await tx.execute(op)).getReceipt(op);
    if (!receipt.accountId) throw new Error(`no account id in the ${role} creation receipt`);
    id = receipt.accountId.toString();
    console.log(`created ${role.toLowerCase()} ${id} with ${seed[role].toString()}`);
  }
  ids[role] = id;
  writeEnv({ [`HD_${role}_ID`]: id });
}

for (const role of ["AGENT", "SELLER", "SELLER_SIGN"] as const) {
  const id = ids[role];
  if ((await tokenBalance(id, USDC_TESTNET)) !== null) continue;
  const k = key(env, `HD_${role}_KEY`);
  // The operator pays for the association, so an account needs no HBAR of its own. The account
  // still signs: for a faucet-made hollow account this also completes it.
  try {
    const tx = await new TokenAssociateTransaction().setAccountId(id).setTokenIds([USDC_TESTNET]).freezeWith(op).sign(k);
    const receipt = await (await tx.execute(op)).getReceipt(op);
    console.log(`associated USDC ${USDC_TESTNET} with ${role.toLowerCase()} ${id}: ${receipt.status.toString()}`);
  } catch (e) {
    // The mirror node lags consensus, so a fresh association can look missing; that one is fine.
    const status = e instanceof ReceiptStatusError || e instanceof StatusError ? e.status : undefined;
    if (status !== Status.TokenAlreadyAssociatedToAccount) throw e;
  }
}

let topic = env.HD_TOPIC_ID;
if (!topic) {
  const agentKey = key(env, "HD_AGENT_KEY");
  const receipt = await (
    await new TopicCreateTransaction().setTopicMemo("countersign spend log").setSubmitKey(agentKey.publicKey).execute(op)
  ).getReceipt(op);
  if (!receipt.topicId) throw new Error("no topic id in the creation receipt");
  topic = receipt.topicId.toString();
  writeEnv({ HD_TOPIC_ID: topic });
  console.log(`created spend-log topic ${topic}`);
}
op.close();

console.log(`operator ${opId}  ${hashscanAccount(opId)}`);
console.log(`agent    ${ids.AGENT}  ${hashscanAccount(ids.AGENT)}`);
console.log(`seller   ${ids.SELLER}  ${hashscanAccount(ids.SELLER)}`);
console.log(`signer   ${ids.SELLER_SIGN}  ${hashscanAccount(ids.SELLER_SIGN)}`);
console.log(`topic    ${topic}  ${hashscanTopic(topic)}`);
