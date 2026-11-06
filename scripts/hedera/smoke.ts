// Live smoke test of the hedera rail on testnet: challenge, countersign, verify, settle, confirm on
// the mirror node, and one refused moved-price payment. Spends 0.01 testnet USDC per run.
//   bun scripts/hedera/smoke.ts [x402.org|blocky402|local]
import { offerHash, type Offer } from "../../packages/core/src/index.ts";
import { hederaPayment } from "../../packages/buyer/src/hedera/signer.ts";
import {
  createHederaRail,
  FACILITATORS,
  hashscanTx,
  httpFacilitator,
  localFacilitator,
  offerHashFromMemo,
  waitForTransaction,
  netFor,
  USDC_TESTNET,
  type Facilitator,
} from "../../packages/rail/src/hedera/index.ts";
import { key, need, readEnv } from "./env.ts";

const env = readEnv();
const which = process.argv[2] ?? "x402.org";
const facilitators: Facilitator[] =
  which === "local"
    ? [localFacilitator(need(env, "HD_OPERATOR_ID"), key(env, "HD_OPERATOR_KEY"))]
    : FACILITATORS.filter((f) => f.name === which).map((f) => httpFacilitator(f.name, f.url));
if (!facilitators.length) throw new Error(`unknown facilitator ${which}`);

const offer: Offer = {
  v: 1,
  seller: "0x00000000000000000000000000000000000000a1",
  title: "hedera rail smoke test",
  summary: "One paid call on the hedera rail.",
  adapter: "openapi",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  deadline: 60,
  bond: "0",
  rails: ["hedera"],
  payTo: { hedera: need(env, "HD_SELLER_ID") },
  issuedAt: Math.floor(Date.now() / 1000),
};
const agent = { accountId: need(env, "HD_AGENT_ID"), key: key(env, "HD_AGENT_KEY") };
const ctx = { resource: "http://localhost/smoke", now: Math.floor(Date.now() / 1000) };

const rail = await createHederaRail({ facilitators, refreshEveryMs: 0 });
console.log(`facilitator ${rail.active?.name} fee payer ${rail.active?.feePayer}`);

// Refusal first: the agent signs at one price, the seller moves it, the rail refuses. Nothing is submitted.
const before = rail.challenge(offer, ctx);
const stale = await hederaPayment(agent, before, ctx.resource);
const moved = rail.challenge({ ...offer, price: "20000" }, ctx);
const refusal = await rail.verify(stale.payment, moved);
console.log(`moved price -> ${refusal.isValid ? "ACCEPTED (bug)" : `refused: ${refusal.invalidReason}`}`);
if (refusal.isValid) process.exit(1);

const req = rail.challenge(offer, ctx);
const t0 = Date.now();
const { payment, transactionId } = await hederaPayment(agent, req, ctx.resource);
const v = await rail.verify(payment, req);
console.log(`verify -> ${JSON.stringify(v)} (${Date.now() - t0} ms)`);
if (!v.isValid) process.exit(1);
const s = await rail.settle(payment, req);
console.log(`settle -> ${JSON.stringify(s)} (${Date.now() - t0} ms)`);
if (!s.success || s.transaction !== transactionId) process.exit(1);

const tx = await waitForTransaction(s.transaction);
const moved$ = tx.tokens[USDC_TESTNET] ?? [];
const memoHash = offerHashFromMemo(tx.memo);
console.log(
  `mirror -> ${tx.result}, seller +${netFor(moved$, req.payTo)}, agent ${netFor(moved$, agent.accountId)}, memo offer ${memoHash === offerHash(offer) ? "matches" : "MISMATCH"}`,
);
console.log(hashscanTx(s.transaction));
if (tx.result !== "SUCCESS" || memoHash !== offerHash(offer) || netFor(moved$, req.payTo) !== 10000n) process.exit(1);

// The same signed payment cannot be used twice.
const replay = await rail.verify(payment, req);
console.log(`replay -> ${replay.isValid ? "ACCEPTED (bug)" : `refused: ${replay.invalidReason}`}`);
process.exit(replay.isValid ? 1 : 0);
