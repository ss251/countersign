// Re-key the held payee to a 2-of-2 of the seller's sign key and this hub's release key, so the
// seller alone can no longer execute a held schedule. The hub key lives in
// ~/.config/countersign/held-hub.env (mode 0600); nothing here prints a private key.
//   bun scripts/hedera/held-rekey.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AccountId, AccountUpdateTransaction, KeyList, PrivateKey } from "@hiero-ledger/sdk";
import { MIRROR_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { mirrorFetch } from "../../packages/rail/src/hedera/mirror.ts";
import { key, need, readEnv, testnetClient } from "./env.ts";

const HUB_ENV_FILE = join(homedir(), ".config", "countersign", "held-hub.env");
const HUB_KEY_NAME = "HEDERA_HELD_HUB_KEY";

function readHubKey(): PrivateKey {
  if (!existsSync(HUB_ENV_FILE)) {
    const generated = PrivateKey.generateED25519();
    mkdirSync(dirname(HUB_ENV_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(HUB_ENV_FILE, `${HUB_KEY_NAME}=${generated.toStringDer()}\n`, { mode: 0o600 });
    chmodSync(HUB_ENV_FILE, 0o600);
    return generated;
  }
  for (const line of readFileSync(HUB_ENV_FILE, "utf8").split("\n")) {
    const match = line.match(/^HEDERA_HELD_HUB_KEY=(.+)$/);
    if (match) return PrivateKey.fromStringED25519(match[1]!);
  }
  throw new Error(`missing ${HUB_KEY_NAME} in ${HUB_ENV_FILE}`);
}

async function readKeyType(accountId: string): Promise<string> {
  const path = `/api/v1/accounts/${accountId}`;
  const r = await mirrorFetch(MIRROR_TESTNET + path);
  if (!r.ok) throw new Error(`mirror ${path} -> ${r.status}`);
  const body: unknown = await r.json();
  if (typeof body !== "object" || body === null) return "unknown";
  const accountKey = (body as Record<string, unknown>).key;
  if (typeof accountKey !== "object" || accountKey === null) return "unknown";
  const type = (accountKey as Record<string, unknown>)._type;
  return typeof type === "string" ? type : "unknown";
}

const env = readEnv();
const accountId = need(env, "HD_SELLER_SIGN_ID");
const sellerKey = key(env, "HD_SELLER_SIGN_KEY");
const hubKey = readHubKey();
const client = testnetClient(accountId, sellerKey);

try {
  const newKey = new KeyList([sellerKey.publicKey, hubKey.publicKey], 2);
  const update = new AccountUpdateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setKey(newKey);
  update.freezeWith(client);
  await update.sign(sellerKey);
  await update.sign(hubKey);
  const response = await update.execute(client);
  const receipt = await response.getReceipt(client);

  console.log(`account  ${accountId}`);
  console.log(`update   ${response.transactionId.toString()}`);
  console.log(`hub      ${hubKey.publicKey.toStringRaw()}`);
  console.log(`receipt  ${receipt.status.toString()}`);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  console.log(`mirror   ${await readKeyType(accountId)}`);
} finally {
  client.close();
}
