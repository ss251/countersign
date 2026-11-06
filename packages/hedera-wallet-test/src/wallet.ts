// A real WalletConnect v2 wallet for hedera:testnet. It pairs by URI, approves a session,
// and answers hedera_signAndExecuteTransaction by signing with a local key and executing.
// The dist/lib index re-exports the library's dApp/modal graph, which calls window.matchMedia
// while loading under `bun test`. The shared entry has the same constants without that graph.
import { HederaChainId, HederaJsonRpcMethod } from "@hashgraph/hedera-wallet-connect/dist/lib/shared/index.js";
import { Client, Status, Transaction, TransferTransaction, type PrivateKey } from "@hiero-ledger/sdk";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";
import { Core } from "@walletconnect/core";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { mkdirSync } from "node:fs";

const CHAIN = HederaChainId.Testnet;
const SESSION_EVENTS = ["chainChanged", "accountsChanged"];

export interface SignAndExecuteParams {
  signerAccountId: string;
  transactionList: string;
}

export interface WalletAccount {
  accountId: string;
  key: PrivateKey;
}

export interface ExecuteResult {
  transactionId: string;
  nodeId: string;
  transactionHash: string;
}

export type Execute = (tx: Transaction) => Promise<ExecuteResult>;

function refused(reason: string): never {
  throw new Error(`Refused. ${reason}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decode, check, sign and execute one hedera_signAndExecuteTransaction request. Pure apart from `execute`. */
export async function handleSignAndExecute(
  params: SignAndExecuteParams,
  wallet: WalletAccount,
  execute: Execute,
): Promise<ExecuteResult> {
  if (params?.signerAccountId !== `${CHAIN}:${wallet.accountId}`) {
    refused(`signerAccountId is not ${CHAIN}:${wallet.accountId}.`);
  }
  if (typeof params.transactionList !== "string") refused("transactionList is not a string.");

  let tx: Transaction;
  try {
    tx = Transaction.fromBytes(Buffer.from(params.transactionList, "base64"));
  } catch {
    refused("transactionList does not decode as a Hedera transaction.");
  }
  if (!(tx instanceof TransferTransaction)) refused("the transaction is not a TransferTransaction.");
  if (tx.transactionId?.accountId?.toString() !== wallet.accountId) {
    refused("the transaction id belongs to another account.");
  }

  try {
    await tx.sign(wallet.key);
  } catch {
    refused("the wallet could not sign the transaction.");
  }

  try {
    return await execute(tx);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refused.")) throw error;
    refused(`execution failed: ${messageOf(error)}`);
  }
}

/** The testnet client, receipt check and evidence a real execution returns. */
export async function executeOnTestnet(wallet: WalletAccount, tx: Transaction): Promise<ExecuteResult> {
  const client = Client.forTestnet().setOperator(wallet.accountId, wallet.key);
  try {
    const response = await tx.execute(client);
    const receipt = await response.getReceipt(client);
    if (receipt.status !== Status.Success) {
      throw new Error(`Refused. execution status ${receipt.status.toString()}.`);
    }
    return {
      transactionId: response.transactionId.toString(),
      nodeId: response.nodeId.toString(),
      transactionHash: Buffer.from(response.transactionHash).toString("hex"),
    };
  } finally {
    client.close();
  }
}

export interface TestWalletOptions {
  projectId: string;
  accountId: string;
  key: PrivateKey;
  storageDir: string;
  execute?: Execute;
}

export interface TestWallet {
  pair(uri: string): Promise<void>;
  sessionTopics(): string[];
  close(): Promise<void>;
}

interface RpcSuccess {
  id: number;
  jsonrpc: "2.0";
  result: ExecuteResult;
}

interface RpcFailure {
  id: number;
  jsonrpc: "2.0";
  error: { code: number; message: string };
}

function requestParams(value: unknown): SignAndExecuteParams {
  if (typeof value !== "object" || value === null) refused("params are not an object.");
  const params = value as { signerAccountId?: unknown; transactionList?: unknown };
  if (typeof params.signerAccountId !== "string" || typeof params.transactionList !== "string") {
    refused("params need signerAccountId and transactionList strings.");
  }
  return { signerAccountId: params.signerAccountId, transactionList: params.transactionList };
}

/** Start the wallet side: Core with its own storage, WalletKit, and both session handlers. */
export async function startTestWallet(options: TestWalletOptions): Promise<TestWallet> {
  mkdirSync(options.storageDir, { recursive: true });
  const core = new Core({
    projectId: options.projectId,
    storageOptions: { database: `${options.storageDir}/wallet.db` },
  });
  const kit = await WalletKit.init({
    core,
    metadata: {
      name: "countersign test wallet",
      description: "Headless Hedera test wallet",
      url: "https://github.com/ss251/countersign",
      icons: [],
    },
  });

  const wallet: WalletAccount = { accountId: options.accountId, key: options.key };
  const execute: Execute = options.execute ?? ((tx) => executeOnTestnet(wallet, tx));
  const topics = new Set<string>();

  kit.on("session_proposal", async (proposal: WalletKitTypes.SessionProposal) => {
    try {
      const namespaces = buildApprovedNamespaces({
        proposal: proposal.params,
        supportedNamespaces: {
          hedera: {
            chains: [CHAIN],
            methods: Object.values(HederaJsonRpcMethod),
            events: SESSION_EVENTS,
            accounts: [`${CHAIN}:${options.accountId}`],
          },
        },
      });
      const session = await kit.approveSession({ id: proposal.id, namespaces });
      topics.add(session.topic);
    } catch (error) {
      console.error(`wallet: proposal ${proposal.id} was not approved: ${messageOf(error)}`);
    }
  });

  kit.on("session_request", async (event: WalletKitTypes.SessionRequest) => {
    const { id, topic } = event;
    let response: RpcSuccess | RpcFailure;
    if (event.params.request.method !== HederaJsonRpcMethod.SignAndExecuteTransaction) {
      response = { id, jsonrpc: "2.0", error: getSdkError("UNSUPPORTED_METHODS") };
    } else {
      try {
        const result = await handleSignAndExecute(requestParams(event.params.request.params), wallet, execute);
        response = { id, jsonrpc: "2.0", result };
      } catch (error) {
        response = { id, jsonrpc: "2.0", error: { code: 9000, message: messageOf(error) } };
      }
    }
    try {
      await kit.respondSessionRequest({ topic, response });
    } catch (error) {
      console.error(`wallet: request ${id} could not be answered: ${messageOf(error)}`);
    }
  });

  return {
    async pair(uri: string): Promise<void> {
      await kit.pair({ uri });
    },
    sessionTopics(): string[] {
      return [...topics];
    },
    async close(): Promise<void> {
      for (const session of Object.values(kit.getActiveSessions())) {
        try {
          await kit.disconnectSession({ topic: session.topic, reason: getSdkError("USER_DISCONNECTED") });
        } catch {
          // A peer that has already gone does not need another goodbye.
        }
      }
      try {
        await kit.core.relayer.transportClose();
      } catch {
        // The relay may never have opened.
      }
    },
  };
}
