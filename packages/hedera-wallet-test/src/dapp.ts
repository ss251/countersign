// The dApp side of the headless round trip: WalletConnect's SignClient directly, because the
// library's dApp classes do not load under Bun (W5). The wire protocol is the one HashPack speaks.
import { HederaChainId, HederaJsonRpcMethod } from "@hashgraph/hedera-wallet-connect/dist/lib/shared/index.js";
import { SignClient } from "@walletconnect/sign-client";
import { getSdkError } from "@walletconnect/utils";
import { mkdirSync } from "node:fs";
import type { ExecuteResult, SignAndExecuteParams } from "./wallet.ts";

const CHAIN = HederaChainId.Testnet;

/** The exact hedera namespace the dApp asks for. Exported so the test can hold it still. */
export const HEDERA_NAMESPACE: { chains: string[]; methods: string[]; events: string[] } = {
  chains: [CHAIN],
  methods: [HederaJsonRpcMethod.SignAndExecuteTransaction],
  events: ["chainChanged", "accountsChanged"],
};

/** "hedera:testnet:0.0.5" -> "0.0.5". */
export function accountFromSession(account: string): string {
  const prefix = `${CHAIN}:`;
  if (!account.startsWith(prefix)) throw new Error(`Refused. ${account} is not a ${CHAIN} account.`);
  const id = account.slice(prefix.length);
  if (!/^0\.0\.\d+$/.test(id)) throw new Error(`Refused. ${account} does not name an account id.`);
  return id;
}

export interface DappOptions {
  projectId: string;
  storageDir: string;
}

export interface SessionApproval {
  topic: string;
  account: string;
}

export interface Dapp {
  connect(): Promise<{ uri: string; approval: Promise<SessionApproval> }>;
  signAndExecute(topic: string, params: SignAndExecuteParams): Promise<ExecuteResult>;
  close(): Promise<void>;
}

/** Start the dApp side with its own storage, separate from the wallet's. */
export async function startDapp(options: DappOptions): Promise<Dapp> {
  mkdirSync(options.storageDir, { recursive: true });
  const client = await SignClient.init({
    projectId: options.projectId,
    metadata: {
      name: "countersign",
      description: "Countersign headless dApp",
      url: "https://github.com/ss251/countersign",
      icons: [],
    },
    storageOptions: { database: `${options.storageDir}/dapp.db` },
  });

  return {
    async connect(): Promise<{ uri: string; approval: Promise<SessionApproval> }> {
      const { uri, approval } = await client.connect({
        optionalNamespaces: { hedera: HEDERA_NAMESPACE },
      });
      if (!uri) throw new Error("Refused. the wallet returned no pairing URI.");
      return {
        uri,
        approval: (async () => {
          const session = await approval();
          const first = session.namespaces.hedera?.accounts[0];
          if (!first) throw new Error("Refused. the approved session has no hedera account.");
          return { topic: session.topic, account: accountFromSession(first) };
        })(),
      };
    },
    async signAndExecute(topic: string, params: SignAndExecuteParams): Promise<ExecuteResult> {
      return client.request<ExecuteResult>({
        topic,
        chainId: CHAIN,
        request: {
          method: HederaJsonRpcMethod.SignAndExecuteTransaction,
          params,
        },
      });
    },
    async close(): Promise<void> {
      for (const session of client.session.getAll()) {
        try {
          await client.disconnect({ topic: session.topic, reason: getSdkError("USER_DISCONNECTED") });
        } catch {
          // Already gone.
        }
      }
      try {
        await client.core.relayer.transportClose();
      } catch {
        // The relay may never have opened.
      }
    },
  };
}
