// Create the wallet's own Hedera testnet account, associate USDC and write its 0600 env file.
// Run only by cs-hd: creation and association spend real testnet HBAR.
//   bun scripts/hedera/wallet-account.ts [--usdc-from-agent <atomic>]
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatUnits } from "../../packages/core/src/index.ts";
import { HBAR_DECIMALS, USDC_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import {
  AccountCreateTransaction,
  AccountId,
  Hbar,
  PrivateKey,
  Status,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from "../../packages/rail/src/hedera/sdk.ts";
import { hbarBalance } from "../../packages/rail/src/hedera/mirror.ts";
import { ENV_DIR, key, need, readEnv, testnetClient } from "./env.ts";

const WALLET_ENV = join(ENV_DIR, "hedera-wallet.env");
const BUDGET_TINYBARS = 170_000_000n; // 1.7 HBAR: create ~0.73, associate ~0.73, 0.2 balance.
const INITIAL_TINYBARS = 20_000_000n; // 0.2 HBAR

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let usdcFromAgent: bigint | null = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--usdc-from-agent") {
    const raw = args[++i] ?? fail("--usdc-from-agent needs an atomic amount");
    if (!/^\d+$/.test(raw)) fail("--usdc-from-agent must be a positive atomic amount");
    usdcFromAgent = BigInt(raw);
    if (usdcFromAgent === 0n) fail("--usdc-from-agent must be above zero");
  } else {
    fail(`unknown argument ${arg}`);
  }
}

const env = readEnv();
const operatorId = need(env, "HD_OPERATOR_ID");
const operatorKey = key(env, "HD_OPERATOR_KEY");

const balance = await hbarBalance(operatorId);
if (balance < BUDGET_TINYBARS) {
  fail(
    `operator ${operatorId} has ${formatUnits(balance, HBAR_DECIMALS)} HBAR; creating the wallet needs about 1.7 HBAR ` +
      "(about 0.73 to create it, 0.73 to associate USDC and 0.2 initial balance).",
  );
}

const operator = testnetClient(operatorId, operatorKey);
const walletKey = PrivateKey.generateED25519();

const create = new AccountCreateTransaction()
  .setKey(walletKey.publicKey)
  .setInitialBalance(Hbar.fromTinybars(INITIAL_TINYBARS.toString()));
const createResponse = await create.execute(operator);
const createReceipt = await createResponse.getReceipt(operator);
if (createReceipt.status !== Status.Success || !createReceipt.accountId) {
  fail(`account creation did not succeed: ${createReceipt.status.toString()}`);
}
const accountId = createReceipt.accountId.toString();

const associate = new TokenAssociateTransaction()
  .setAccountId(accountId)
  .setTokenIds([USDC_TESTNET]);
const associateTx = await associate.freezeWith(operator).sign(walletKey);
const associateResponse = await associateTx.execute(operator);
const associateReceipt = await associateResponse.getReceipt(operator);
if (associateReceipt.status !== Status.Success) {
  fail(`USDC association did not succeed: ${associateReceipt.status.toString()}`);
}

mkdirSync(ENV_DIR, { recursive: true, mode: 0o700 });
chmodSync(ENV_DIR, 0o700);
writeFileSync(
  WALLET_ENV,
  `WALLET_ACCOUNT_ID=${accountId}\nWALLET_KEY=${walletKey.toStringDer()}\nWALLET_KEY_TYPE=ed25519\n`,
  { mode: 0o600 },
);
chmodSync(WALLET_ENV, 0o600);

console.log(`account   ${accountId}`);
console.log(`create    ${createResponse.transactionId.toString()}`);
console.log(`associate ${associateResponse.transactionId.toString()}`);

if (usdcFromAgent !== null) {
  const agentId = need(env, "HD_AGENT_ID");
  const agent = testnetClient(agentId, key(env, "HD_AGENT_KEY"));
  const token = TokenId.fromString(USDC_TESTNET);
  const transfer = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(agentId), -usdcFromAgent)
    .addTokenTransfer(token, AccountId.fromString(accountId), usdcFromAgent);
  const transferResponse = await transfer.execute(agent);
  const transferReceipt = await transferResponse.getReceipt(agent);
  agent.close();
  if (transferReceipt.status !== Status.Success) {
    fail(`USDC transfer did not succeed: ${transferReceipt.status.toString()}`);
  }
  console.log(`usdc      ${transferResponse.transactionId.toString()}`);
}

operator.close();
