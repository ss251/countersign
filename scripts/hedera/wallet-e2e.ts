// The headless wallet round trip: a real WalletConnect session, a wallet-signed USDC transfer,
// the hub's mirror check, and the slip. It prints the session topic, the transaction id and the
// mirror readback (STEER-2120 item 2). It never prints a key or the payment secret.
//   bun scripts/hedera/wallet-e2e.ts --offer <hash> --input <json> [--hub <url>] [--json]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type PaymentRequired,
  type Slip,
} from "../../packages/core/src/index.ts";
import {
  buildWalletTransfer,
  checkWalletPayment,
  findHederaExact,
  newWalletSecret,
  signAndExecuteParams,
  waitForTransaction,
  walletMemo,
  walletPaymentPayload,
} from "../../packages/rail/src/hedera/index.ts";
import { startDapp, type Dapp } from "../../packages/hedera-wallet-test/src/dapp.ts";
import { readProjectId, readWalletEnv } from "../../packages/hedera-wallet-test/src/env.ts";
import { startTestWallet, type TestWallet } from "../../packages/hedera-wallet-test/src/wallet.ts";
import { verifySlip } from "../../packages/verify/src/index.ts";

const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";

function fail(message: string): never {
  throw new Error(message);
}

const argv = process.argv.slice(2);
let offerFlag: string | undefined;
let inputFlag: string | undefined;
let hubFlag = DEFAULT_HUB;
let json = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--offer") offerFlag = argv[++i] ?? fail("--offer needs an offer hash");
  else if (arg === "--input") inputFlag = argv[++i] ?? fail("--input needs a JSON value");
  else if (arg === "--hub") hubFlag = argv[++i] ?? fail("--hub needs a URL");
  else if (arg === "--json") json = true;
  else fail(`unknown argument ${arg}`);
}
if (!offerFlag) fail("--offer is required");
if (inputFlag === undefined) fail("--input is required");
const offerHash: string = offerFlag;
let input: unknown;
try {
  input = JSON.parse(inputFlag);
} catch {
  fail("--input is not JSON");
}
const hub = hubFlag.replace(/\/+$/, "");

function say(...line: unknown[]): void {
  if (json) console.error(...line);
  else console.log(...line);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function paymentRequired(response: Response, text: string): PaymentRequired {
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header) {
    try {
      const value: unknown = fromBase64Json(header);
      if (isRecord(value) && Array.isArray(value.accepts)) return value as unknown as PaymentRequired;
    } catch {
      // A broken header falls through to the body.
    }
  }
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && Array.isArray(body.accepts)) return body as unknown as PaymentRequired;
  } catch {
    // The error below is the useful one.
  }
  return fail("the hub's 402 carried no PaymentRequired body");
}

function errorText(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.message === "string") return body.message;
  } catch {
    // Not JSON.
  }
  return text.slice(0, 300);
}

async function call(payment?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers[PAYMENT_SIGNATURE_HEADER] = payment;
  return fetch(`${hub}/offers/${encodeURIComponent(offerHash)}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
}

interface Evidence {
  sessionTopic: string;
  account: string;
  transactionId: string;
  mirror: {
    result: string;
    memo: string;
    consensusTimestamp: string;
    transfers: { account: string; amount: string }[];
  } | null;
  slip: string;
  verifier: { valid: boolean; findings: { check: string; ok: boolean; detail: string }[] };
}

const evidence: Evidence = {
  sessionTopic: "",
  account: "",
  transactionId: "",
  mirror: null,
  slip: "",
  verifier: { valid: false, findings: [] },
};
let ok = false;
let mirrorProblem = "";
let wallet: TestWallet | null = null;
let dapp: Dapp | null = null;

try {
  const projectId = readProjectId();
  const walletEnv = readWalletEnv();
  evidence.account = walletEnv.accountId;
  const storage = mkdtempSync(join(tmpdir(), "countersign-wallet-e2e-"));

  wallet = await startTestWallet({
    projectId,
    accountId: walletEnv.accountId,
    key: walletEnv.key,
    storageDir: storage,
  });
  dapp = await startDapp({ projectId, storageDir: storage });

  const connection = await dapp.connect();
  await wallet.pair(connection.uri);
  const session = await connection.approval;
  evidence.sessionTopic = session.topic;
  evidence.account = session.account;
  if (session.account !== walletEnv.accountId) {
    fail(`the wallet approved ${session.account}, not ${walletEnv.accountId}`);
  }

  const challenge = await call();
  const challengeText = await challenge.text();
  if (challenge.status !== 402) {
    fail(`the hub answered ${challenge.status}, expected a 402: ${errorText(challengeText)}`);
  }
  const required = paymentRequired(challenge, challengeText);
  const req = findHederaExact(required.accepts);
  if (!req) {
    const networks = required.accepts.map((entry) => entry.network).join(", ") || "none";
    fail(`the offer's 402 has no hedera:testnet exact entry (accepts: ${networks})`);
  }

  const secret = newWalletSecret();
  const tx = buildWalletTransfer(req, session.account, { secret });
  const signed = await dapp.signAndExecute(session.topic, signAndExecuteParams(session.account, tx));
  evidence.transactionId = signed.transactionId;

  const paid = await call(toBase64Json(walletPaymentPayload(req, signed.transactionId, session.account, secret)));
  const paidText = await paid.text();
  if (paid.status !== 200) {
    fail(`the hub answered ${paid.status}: ${errorText(paidText)}`);
  }
  const answer: unknown = JSON.parse(paidText);
  if (!isRecord(answer) || !isRecord(answer.slip)) fail("the hub's 200 carried no slip");
  const slip = answer.slip as unknown as Slip;

  const mirror = await waitForTransaction(signed.transactionId, { timeoutMs: 60_000 });
  evidence.mirror = {
    result: mirror.result,
    memo: mirror.memo,
    consensusTimestamp: mirror.consensusTimestamp,
    transfers: (mirror.tokens[req.asset] ?? []).map((transfer) => ({
      account: transfer.account,
      amount: transfer.amount.toString(),
    })),
  };

  const expectedMemo = walletMemo(offerHash, secret);
  const memoOk = mirror.memo.toLowerCase() === expectedMemo.toLowerCase();
  const check = checkWalletPayment(mirror, req, session.account, secret, Math.floor(Date.now() / 1000));
  if (!check.ok) mirrorProblem = check.reason;
  else if (!memoOk) mirrorProblem = "claim_unproven";

  const verdict = await verifySlip(slip);
  evidence.slip = slip.hash;
  evidence.verifier = { valid: verdict.valid, findings: verdict.findings };

  ok = check.ok && memoOk && verdict.valid;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await dapp?.close().catch(() => {});
  await wallet?.close().catch(() => {});
}

say(`session  ${evidence.sessionTopic}`);
say(`account  ${evidence.account}`);
say(`tx       ${evidence.transactionId}`);
if (evidence.mirror) {
  say(`mirror   ${evidence.mirror.result} ${evidence.mirror.consensusTimestamp}`);
  say(`memo     ${evidence.mirror.memo}`);
  for (const transfer of evidence.mirror.transfers) {
    say(`transfer ${transfer.account} ${transfer.amount}`);
  }
}
if (mirrorProblem) say(`mirror   refused: ${mirrorProblem}`);
say(`slip     ${evidence.slip}`);
say(`verify   ${evidence.verifier.valid}`);
for (const finding of evidence.verifier.findings.filter((entry) => !entry.ok)) {
  say(`finding  ${finding.check}: ${finding.detail}`);
}
if (!json) say(`ok       ${ok}`);
if (json) console.log(JSON.stringify({ beat: "hedera-wallet", ok, evidence }));
process.exitCode = ok ? 0 : 1;
