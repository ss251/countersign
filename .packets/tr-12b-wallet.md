# tr-12b: countersign address, balance and withdraw (refs #246)

**Design: decided.** cs-truth wrote this on Opus for STEER-0240 item 3. Implement exactly what follows. Nothing here is left for you to choose. **This is a secrets surface: no code path may print, log or put into an error message a key's value.** Work fast. A parallel packet, tr-12a, writes the keystore and wires these commands into `cli.ts`. You write only `packages/cli/src/wallet.ts` and its test, with exactly the exported signature below, so that it drops into tr-12a's wiring.

## `packages/cli/src/wallet.ts` (new), exactly

```ts
/**
 * countersign address | balance | withdraw (STEER-0240). The key is loaded through deps.loadKey and only
 * ever handed to the signer. Nothing here prints, logs or throws a key's value.
 */
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type Role = "buyer" | "seller";
const ROLES: Role[] = ["buyer", "seller"];
const NO_KEY_MESSAGE = "No countersign key yet. Run: npx -y @countersign-hub/cli init";

export const ARC = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  usdc: "0x3600000000000000000000000000000000000000",
  explorerTx: "https://explorer.testnet.arc.io/tx/",
} as const;
export const WHITECHAIN = {
  chainId: 1874,
  rpc: "https://rpc.ankr.com/whitechain_testnet",
  usdt: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
} as const;
/** Arc pays gas in USDC, so a full withdrawal leaves this much behind (0.01 USDC). */
export const GAS_RESERVE = 10_000n;

export interface ChainAccess {
  erc20Balance(chainId: number, token: string, owner: string): Promise<bigint>;
  erc20Transfer(key: string, chainId: number, token: string, to: string, amount: bigint): Promise<string>;
}

export interface WalletDeps {
  loadKey: (role: Role) => string | null;
  write: (text: string) => void;
  chain?: ChainAccess;
}

const arcChain = defineChain({
  id: ARC.chainId,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC.rpc] } },
});
const whitechainChain = defineChain({
  id: WHITECHAIN.chainId,
  name: "Whitechain testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: [WHITECHAIN.rpc] } },
});

function chainFor(chainId: number) {
  return chainId === WHITECHAIN.chainId ? whitechainChain : arcChain;
}

export const viemChainAccess: ChainAccess = {
  async erc20Balance(chainId, token, owner) {
    const client = createPublicClient({ chain: chainFor(chainId), transport: http() });
    return client.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner as `0x${string}`],
    });
  },
  async erc20Transfer(key, chainId, token, to, amount) {
    const chain = chainFor(chainId);
    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({ account, chain, transport: http() });
    const hash = await wallet.writeContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as `0x${string}`, amount],
      account,
      chain,
    });
    await createPublicClient({ chain, transport: http() }).waitForTransactionReceipt({ hash });
    return hash;
  },
};

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function addressOf(key: string): string {
  return privateKeyToAccount(key as `0x${string}`).address;
}

function noKey(): void {
  process.stderr.write(`${NO_KEY_MESSAGE}\n`);
  process.exitCode = 1;
}

function refuse(message: string, code = 2): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

/** address | balance | withdraw. */
export async function runWallet(
  command: "address" | "balance" | "withdraw",
  args: string[],
  deps: WalletDeps,
): Promise<void> {
  const chain = deps.chain ?? viemChainAccess;
  if (command === "address") {
    const keys = ROLES.map((role) => [role, deps.loadKey(role)] as const);
    if (keys.every(([, key]) => key === null)) return noKey();
    for (const [role, key] of keys) {
      deps.write(key === null ? `${role}: none yet. Run: npx -y @countersign-hub/cli init\n` : `${role}: ${addressOf(key)}\n`);
    }
    return;
  }
  if (command === "balance") {
    const keys = ROLES.map((role) => [role, deps.loadKey(role)] as const);
    if (keys.every(([, key]) => key === null)) return noKey();
    for (const [role, key] of keys) {
      if (key === null) continue;
      const address = addressOf(key);
      const arc = await chain.erc20Balance(ARC.chainId, ARC.usdc, address).then(
        (value) => `${formatUnits(value, 6)} USDC on Arc`,
        () => "Arc unavailable",
      );
      const wc = await chain.erc20Balance(WHITECHAIN.chainId, WHITECHAIN.usdt, address).then(
        (value) => `${formatUnits(value, 6)} USDT on Whitechain`,
        () => "Whitechain unavailable",
      );
      deps.write(`${role} ${address}: ${arc}, ${wc}\n`);
    }
    return;
  }
  // withdraw
  const to = flag(args, "--to");
  if (to === undefined || !isAddress(to)) return refuse("countersign withdraw needs --to <your address>.");
  const chainName = flag(args, "--chain") ?? "arc";
  if (chainName !== "arc") return refuse("countersign withdraw is Arc only tonight.");
  const roleName = flag(args, "--role") ?? "buyer";
  if (roleName !== "buyer" && roleName !== "seller") return refuse("countersign withdraw --role takes buyer or seller.");
  const key = deps.loadKey(roleName);
  if (key === null) return noKey();
  const from = addressOf(key);
  let balance: bigint;
  try {
    balance = await chain.erc20Balance(ARC.chainId, ARC.usdc, from);
  } catch {
    return refuse("Arc could not be read. Try again.", 1);
  }
  const named = flag(args, "--amount");
  let amount: bigint;
  if (named !== undefined) {
    try {
      amount = parseUnits(named, 6);
    } catch {
      return refuse("countersign withdraw --amount takes a USDC amount, such as 0.25.");
    }
  } else {
    amount = balance - GAS_RESERVE;
  }
  if (amount <= 0n) return refuse(`Nothing to withdraw: the agent holds ${formatUnits(balance, 6)} USDC on Arc.`, 1);
  if (amount > balance) return refuse(`Not enough: the agent holds ${formatUnits(balance, 6)} USDC on Arc.`, 1);
  let hash: string;
  try {
    hash = await chain.erc20Transfer(key, ARC.chainId, ARC.usdc, to, amount);
  } catch {
    return refuse("The transfer did not go through. Nothing was sent.", 1);
  }
  deps.write(`Sent ${formatUnits(amount, 6)} USDC from ${from} to ${to} on Arc: ${ARC.explorerTx}${hash}\n`);
}
```

## Lease

- new: `packages/cli/src/wallet.ts` and `packages/cli/test/wallet.test.ts`.

Read only: everything else. Do NOT touch `packages/cli/src/cli.ts`. Never commit `bun.lock`.

## Tests (`packages/cli/test/wallet.test.ts`, bun:test, no network)

Use two fixed test keys: `K1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` (buyer) and `K2 = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` (seller).
- A fake `ChainAccess` records its calls and returns preset balances. Its transfer returns `0x${"ab".repeat(32)}`.
- Capture `deps.write`, plus `process.stderr.write` with `spyOn`.
- Reset `process.exitCode = 0` after each test.

1. **`address`.**
   - With only the buyer key, it writes `buyer: <K1's address>` and `seller: none yet. Run: npx -y @countersign-hub/cli init`.
   - With no keys, it sets exit code 1 and writes `No countersign key yet. Run: npx -y @countersign-hub/cli init` to stderr.
2. **`balance`.** With Arc `1500000n` and Whitechain `2000000n`, it writes `1.5 USDC on Arc, 2 USDT on Whitechain`. A rejected Whitechain read writes `Whitechain unavailable`.
3. **`withdraw` builds the right transfer.** Balance `1000000n`, `--to 0x000000000000000000000000000000000000dEaD --amount 0.25`.
   - `erc20Transfer` is called once with `(K1, 5042002, "0x3600000000000000000000000000000000000000", "0x000000000000000000000000000000000000dEaD", 250000n)`.
   - The output ends with `https://explorer.testnet.arc.io/tx/0xabab…ab`.
4. **Withdraw all.** No `--amount` and balance `1000000n` sends `990000n`.
5. **Refusals.**
   - No `--to`, or a bad one, gives exit 2. `--chain whitechain` gives exit 2 with `Arc only tonight`. `--role nope` gives exit 2.
   - No key gives exit 1 with the no-key message.
   - Balance `5000n` with no amount gives exit 1 with `Nothing to withdraw`. `--amount 2` against `1000000n` gives exit 1 with `Not enough`.
   - A transfer that throws gives exit 1 with `Nothing was sent`.
6. **Redaction.** Across every case, the captured stdout and stderr never contain K1's or K2's 64 hex digits, in either case.

## Constraints

- **No browser** of any kind.
- **No network** in tests: the fake `ChainAccess` only.
- **Never print, log or put into an error message a key's value.**
- **Never run `git stash`.**
- **Existing tests:** never edit, weaken, skip or delete one.
- **Commits:** one or two, present tense, ending `refs #246`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 20 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-12b-wallet.md` (on the second machine): the diff summary, the test names and the gate counts. Write no key value in it.
