// Balances of the lane's accounts from the mirror node: HBAR and testnet USDC, nothing secret.
//   bun scripts/hedera/status.ts
import { formatUnits } from "../../packages/core/src/index.ts";
import { HBAR_DECIMALS, USDC_DECIMALS, USDC_TESTNET } from "../../packages/rail/src/hedera/constants.ts";
import { hbarBalance, resolveAccount, tokenBalance } from "../../packages/rail/src/hedera/mirror.ts";
import { readEnv } from "./env.ts";

const env = readEnv();
for (const role of ["OPERATOR", "AGENT", "SELLER"] as const) {
  const evm = env[`HD_${role}_EVM`];
  const id = env[`HD_${role}_ID`] ?? (evm ? await resolveAccount(evm) : null);
  if (!id) {
    console.log(`${role.toLowerCase().padEnd(9)} not created (${evm ?? "no key"})`);
    continue;
  }
  const hbar = formatUnits(await hbarBalance(id), HBAR_DECIMALS);
  const usdc = await tokenBalance(id, USDC_TESTNET);
  const usdcText = usdc === null ? "USDC not associated" : `${formatUnits(usdc, USDC_DECIMALS)} USDC`;
  console.log(`${role.toLowerCase().padEnd(9)} ${id.padEnd(12)} ${hbar} HBAR  ${usdcText}`);
}
if (env.HD_TOPIC_ID) console.log(`topic     ${env.HD_TOPIC_ID}`);
