// Generate the lane's ECDSA keys once. Prints EVM addresses only; never replaces an existing key.
//   bun scripts/hedera/keygen.ts
import { PrivateKey } from "../../packages/rail/src/hedera/sdk.ts";
import { ENV_FILE, readEnv, writeEnv, type Env } from "./env.ts";

const ROLES = ["OPERATOR", "AGENT", "SELLER"] as const;

const env = readEnv();
const updates: Env = {};
for (const role of ROLES) {
  if (env[`HD_${role}_KEY`]) continue;
  const k = PrivateKey.generateECDSA();
  updates[`HD_${role}_KEY`] = k.toStringRaw();
  updates[`HD_${role}_EVM`] = "0x" + k.publicKey.toEvmAddress();
}
if (Object.keys(updates).length) writeEnv(updates);

const after = readEnv();
for (const role of ROLES) console.log(`${role.toLowerCase().padEnd(9)} ${after[`HD_${role}_EVM`]}`);
console.log(`keys in ${ENV_FILE}`);
