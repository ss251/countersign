// Create the buyer's Hedera testnet account from the second Privy wallet's secp256k1 key. The key
// is also the account's EVM-address alias, so USDC can arrive without a separate association.
import { AccountCreateTransaction, Client, PublicKey } from "@hiero-ledger/sdk";

export interface HederaOperator {
  id: string;
  /** Never logged, never stored. */
  key: string;
}

export interface CreatedHederaAccount {
  accountId: string;
}

/** The operator pays the creation fee; the account starts with no HBAR of its own. */
export async function createEcdsaAccount(
  operator: HederaOperator,
  compressedPublicKey: string,
): Promise<CreatedHederaAccount> {
  const key = PublicKey.fromString(compressedPublicKey);
  const client = Client.forTestnet().setOperator(operator.id, operator.key);
  try {
    const transaction = new AccountCreateTransaction()
      .setECDSAKeyWithAlias(key)
      .setMaxAutomaticTokenAssociations(-1)
      .setInitialBalance(0);
    const response = await transaction.execute(client);
    const receipt = await response.getReceipt(client);
    const accountId = receipt.accountId;
    if (accountId === null) throw new Error("the network created no account");
    return { accountId: accountId.toString() };
  } finally {
    client.close();
  }
}
