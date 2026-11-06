// The recorded Hedera beat, end to end: the agent finds the offer, the envelope approves, the
// agent countersigns, the facilitator settles, the spend and the capped refusal land on HCS, and
// the run reconciles against the chain. Every line is a fact read back from the network.
//   bun scripts/hedera/beat.ts [--hub <url>] [--json]
import {
  checkEnvelope,
  formatUnits,
  fromBase64Json,
  offerHash,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
} from "../../packages/core/src/index.ts";
import { createHederaAgent, spentFromLog, type Listing } from "../../packages/buyer/src/hedera/agent.ts";
import { readEntries, reconcile, type LoggedEntry } from "../../packages/buyer/src/hedera/spendlog.ts";
import {
  createHederaRail,
  FACILITATORS,
  hashscanAccount,
  hashscanTopic,
  hashscanTx,
  HEDERA_TESTNET,
  httpFacilitator,
  parseTxId,
  USDC_TESTNET,
  waitForTransaction,
} from "../../packages/rail/src/hedera/index.ts";
import {
  HBAR_DECIMALS,
  MIRROR_TESTNET,
  USDC_DECIMALS,
} from "../../packages/rail/src/hedera/constants.ts";
import { hbarBalance, tokenBalance } from "../../packages/rail/src/hedera/mirror.ts";
import type { Client } from "../../packages/rail/src/hedera/sdk.ts";
import { key, need, readEnv, testnetClient } from "./env.ts";

const USDC_FLOOR = 1_000_000n; // 1.00 USDC, six decimals
const HBAR_FLOOR = 50_000_000n; // 0.50 HBAR, eight decimals
const usdc = (atomic: bigint | string) => formatUnits(BigInt(atomic), USDC_DECIMALS);
const hbar = (atomic: bigint) => formatUnits(atomic, HBAR_DECIMALS);
const mirrorMessage = (topicId: string, sequence: number) =>
  `${MIRROR_TESTNET}/api/v1/topics/${topicId}/messages/${sequence}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let hubFlag: string | null = null;
let json = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--hub") hubFlag = args[++i] ?? fail("--hub needs a url");
  else if (arg === "--json") json = true;
  else fail(`unknown argument ${arg}`);
}

function say(...line: unknown[]): void {
  if (json) console.error(...line);
  else console.log(...line);
}

interface Evidence {
  label: string;
  value: string | number;
  url?: string;
}

const evidence: Evidence[] = [];
let ok = false;

const env = readEnv();
const agentId = need(env, "HD_AGENT_ID");
const agentEvm = need(env, "HD_AGENT_EVM");
const topicId = need(env, "HD_TOPIC_ID");

// The funds gate comes before the hub, the log and any signing: nothing may be spent short.
let agentUsdc: bigint | null;
let agentHbar: bigint;
try {
  [agentUsdc, agentHbar] = await Promise.all([tokenBalance(agentId, USDC_TESTNET), hbarBalance(agentId)]);
} catch (error) {
  say(`error    ${error instanceof Error ? error.message : String(error)}`);
  evidence.push({ label: "agent", value: agentId, url: hashscanAccount(agentId) });
  if (json) console.log(JSON.stringify({ beat: "hedera", ok: false, evidence }));
  process.exit(1);
}
const shortUsdc = (agentUsdc ?? 0n) < USDC_FLOOR;
const shortHbar = agentHbar < HBAR_FLOOR;
if (shortUsdc || shortHbar) {
  if (shortUsdc) {
    say(`funds    agent ${agentId} has ${agentUsdc === null ? "no USDC association" : `${usdc(agentUsdc)} USDC`}; the floor is 1.00 USDC`);
    say("faucet   https://faucet.circle.com/ - USDC on Hedera Testnet");
  }
  if (shortHbar) {
    say(`funds    agent ${agentId} has ${hbar(agentHbar)} HBAR; the floor is 0.50 HBAR`);
    say(`faucet   https://portal.hedera.com/faucet - HBAR to ${agentEvm}`);
  }
  evidence.push({ label: "agent", value: agentId, url: hashscanAccount(agentId) });
  if (json) console.log(JSON.stringify({ beat: "hedera", ok: false, evidence }));
  process.exit(2);
}

/** The one-offer hub from hub-standin.ts, in this process and on a free port. */
async function startStandInHub(): Promise<{ url: string; stop: () => void }> {
  const payTo = need(env, "HD_SELLER_ID");
  const offer: Offer = {
    v: 1,
    seller: (env.HD_SELLER_EVM ?? "0x00000000000000000000000000000000000000a1") as Offer["seller"],
    title: "hedera stand-in call",
    summary: "One paid call from the stand-in hub, settled on the hedera rail.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: payTo },
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const hash = offerHash(offer);
  const listing = { offerHash: hash, offer, online: true, status: "listed" as const };

  const rail = await createHederaRail();
  if (!rail.active) throw new Error("no facilitator lists exact on hedera:testnet");

  function requiredFor(resource: string): PaymentRequired {
    const requirements = rail.challenge(offer, { resource, now: Math.floor(Date.now() / 1000) });
    return { x402Version: 2, resource: { url: resource }, accepts: [requirements] };
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/offers") {
        return Response.json({ offers: [listing] });
      }
      if (request.method === "POST" && url.pathname === `/offers/${hash}/call`) {
        const signature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
        if (!signature) {
          const required = requiredFor(url.toString());
          return new Response(JSON.stringify(required), {
            status: 402,
            headers: { "content-type": "application/json", [PAYMENT_REQUIRED_HEADER]: toBase64Json(required) },
          });
        }
        const payment = fromBase64Json<PaymentPayload>(signature);
        const requirements = requiredFor(url.toString()).accepts[0]!;
        const verified = await rail.verify(payment, requirements);
        if (!verified.isValid) {
          return Response.json(
            { code: "payment_invalid", message: `refused: ${verified.invalidReason ?? "invalid"}` },
            { status: 402 },
          );
        }
        const settlement = await rail.settle(payment, requirements);
        if (!settlement.success) {
          return Response.json(
            { code: "settle_failed", message: settlement.errorReason ?? "settlement failed" },
            { status: 402 },
          );
        }
        const body = {
          output: { ok: true },
          slip: {
            settlement: {
              transaction: settlement.transaction,
              network: settlement.network,
              url: hashscanTx(settlement.transaction),
            },
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json", [PAYMENT_RESPONSE_HEADER]: toBase64Json(settlement) },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

let hubStop: (() => void) | null = null;
let logClient: Client | null = null;
try {
  let hub = hubFlag;
  if (!hub) {
    const standIn = await startStandInHub();
    hub = standIn.url;
    hubStop = standIn.stop;
  }

  const agentKey = key(env, "HD_AGENT_KEY");
  const base = hub.replace(/\/$/, "");
  const topicLink = hashscanTopic(topicId);
  const facilitatorNames = new Map<string, string>();
  const trustedFeePayers = new Set<string>();
  const operatorId = env.HD_OPERATOR_ID;
  if (operatorId) {
    trustedFeePayers.add(operatorId);
    facilitatorNames.set(operatorId, "local");
  }
  await Promise.all(
    FACILITATORS.map(async ({ name, url }) => {
      try {
        const feePayer = await httpFacilitator(name, url).feePayer();
        if (feePayer) {
          trustedFeePayers.add(feePayer);
          facilitatorNames.set(feePayer, name);
        }
      } catch {
        // A facilitator that cannot answer is not trusted for this run.
      }
    }),
  );

  // Watch the agent's own challenges: the fee payer in one names the facilitator behind it.
  let challengeFeePayer: string | null = null;
  const watchChallenges = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (response.status === 402) {
      const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
      try {
        const required = header
          ? fromBase64Json<PaymentRequired>(header)
          : ((await response.clone().json()) as PaymentRequired);
        const req = required.accepts?.find((a) => a.network === HEDERA_TESTNET && a.scheme === "exact");
        if (typeof req?.extra?.feePayer === "string") challengeFeePayer = req.extra.feePayer;
      } catch {
        // A 402 without a readable challenge is not evidence.
      }
    }
    return response;
  }) as typeof fetch;

  const prior = await readEntries(topicId);
  const spent = spentFromLog(prior);
  const envelope: Envelope = {
    v: 1,
    agent: agentEvm as Envelope["agent"],
    cap: "0",
    perMerchant: "0",
    allowlist: [],
    revoked: false,
  };
  logClient = testnetClient(agentId, agentKey);
  const agent = createHederaAgent({
    hub: base,
    payer: { accountId: agentId, key: agentKey },
    envelope,
    topicId,
    logClient,
    spent,
    trustedFeePayers: [...trustedFeePayers],
    fetch: watchChallenges,
  });

  const listings = await agent.discover();
  const listing: Listing | undefined = listings[0];
  if (!listing) {
    say("no listed, online hedera offers");
  } else {
    const price = BigInt(listing.offer.price);
    // Exactly one call fits: the first leaves half a price under the cap, the second crosses it.
    const cap = BigInt(spent.total) + price + price / 2n;
    envelope.cap = cap.toString(10);
    // The total cap always binds before the merchant limit, so the refusal names the budget.
    envelope.perMerchant = cap.toString(10);

    say(`agent    ${agentId}  ${hashscanAccount(agentId)}`);
    say(
      `offer    ${listing.offer.title}  ${usdc(listing.offer.price)} USDC  payTo ${listing.offer.payTo?.hedera}  ${listing.offerHash}`,
    );
    evidence.push({ label: "agent", value: agentId, url: hashscanAccount(agentId) });
    evidence.push({ label: "offer", value: listing.offerHash });

    const decision = checkEnvelope(
      envelope,
      spent,
      { seller: listing.offer.seller, offerHash: listing.offerHash, amount: listing.offer.price },
      Math.floor(Date.now() / 1000),
    );
    say(`envelope cap ${usdc(cap)} USDC  spent ${usdc(spent.total)} USDC  ${decision.ok ? "approved" : decision.message}`);
    if (!decision.ok) throw new Error(`the envelope refused the advertised price: ${decision.message}`);

    // The run's window starts now, in consensus-style time, before anything is signed or logged.
    const since = `${Math.floor(Date.now() / 1000)}.000000000`;
    const sinceSeconds = Number(since.split(".")[0]);

    let paid = false;
    let spendSequence: number | undefined;
    let facilitator: string | null = null;

    challengeFeePayer = null;
    const first = await agent.buy(listing, {});
    if (first.kind === "paid") {
      spendSequence = first.logSequence;
      const feePayer =
        challengeFeePayer ??
        (() => {
          try {
            return parseTxId(first.transactionId).payer;
          } catch {
            return null;
          }
        })();
      facilitator = feePayer ? (facilitatorNames.get(feePayer) ?? feePayer) : null;
      if (facilitator) evidence.push({ label: "facilitator", value: facilitator });
      say(`Countersigned ${first.transactionId}`);
      try {
        const tx = await waitForTransaction(first.transactionId);
        if (tx.result === "SUCCESS") {
          paid = true;
          say(`Settled on Hedera by ${facilitator ?? "an unknown fee payer"}  ${hashscanTx(first.transactionId)}`);
        } else {
          say(`settled with result ${tx.result}  ${hashscanTx(first.transactionId)}`);
        }
      } catch (error) {
        say(`settle    ${error instanceof Error ? error.message : String(error)}`);
      }
      say(
        `spend log #${first.logSequence}  ${topicLink}  ${mirrorMessage(topicId, first.logSequence)}`,
      );
      evidence.push({ label: "payment", value: first.transactionId, url: hashscanTx(first.transactionId) });
      evidence.push({ label: "spend log", value: `#${first.logSequence}`, url: topicLink });
    } else if (first.kind === "refused") {
      say(first.message);
      evidence.push({ label: "refusal", value: first.message });
      if (first.logSequence !== undefined) {
        say(
          `refusal log #${first.logSequence}  ${topicLink}  ${mirrorMessage(topicId, first.logSequence)}`,
        );
        evidence.push({ label: "refusal log", value: `#${first.logSequence}`, url: topicLink });
      }
    } else {
      say(`call failed: HTTP ${first.status}  ${first.message}`);
    }

    // The second call is the point of the cap: it must be refused and logged, never signed.
    challengeFeePayer = null;
    const second = await agent.buy(listing, {});
    let refusalSequence: number | undefined;
    if (second.kind === "refused") {
      refusalSequence = second.logSequence;
      say(second.message);
      evidence.push({ label: "refusal", value: second.message });
      if (second.logSequence !== undefined) {
        say(
          `refusal log #${second.logSequence}  ${topicLink}  ${mirrorMessage(topicId, second.logSequence)}`,
        );
        evidence.push({ label: "refusal log", value: `#${second.logSequence}`, url: topicLink });
      }
    } else if (second.kind === "paid") {
      say(`second call paid: ${second.transactionId} (the cap did not refuse it)`);
    } else {
      say(`second call failed: HTTP ${second.status}  ${second.message}`);
    }

    // Read the run's HCS entries back from the mirror before auditing them.
    const expected = [spendSequence, refusalSequence].filter((s): s is number => s !== undefined);
    const expectedSet = new Set(expected);
    let entries: LoggedEntry[] = [];
    const deadline = Date.now() + 30_000;
    for (;;) {
      const all = await readEntries(topicId);
      entries = all.filter(
        (e) => Number(e.consensusAt.split(".")[0]) >= sinceSeconds || expectedSet.has(e.sequence),
      );
      const seen = new Set(entries.map((e) => e.sequence));
      if (expected.every((s) => seen.has(s)) || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 1_500));
    }

    const audit = await reconcile(entries, agentId, USDC_TESTNET, { since });
    const auditLine = `matched ${audit.matched.length}, unbacked ${audit.unbacked.length}, unlogged ${audit.unlogged.length}`;
    say(`audit    ${auditLine}`);
    for (const { logged, why } of audit.unbacked) {
      say(`unbacked sequence ${logged.sequence}  ${logged.entry.tx ?? "(no tx)"}  ${why}`);
    }
    for (const tx of audit.unlogged) say(`unlogged ${tx}  ${hashscanTx(tx)}`);
    evidence.push({ label: "audit", value: auditLine });

    ok =
      paid &&
      first.kind === "paid" &&
      second.kind === "refused" &&
      second.reason === "over-cap" &&
      second.logSequence !== undefined &&
      audit.unbacked.length === 0 &&
      audit.unlogged.length === 0;
  }
} catch (error) {
  say(`error    ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  logClient?.close();
  hubStop?.();
}

if (json) console.log(JSON.stringify({ beat: "hedera", ok, evidence }));
process.exitCode = ok ? 0 : 1;
