/**
 * The seller's bond commands against anvil: deposit signs an EIP-3009 authorisation and submits
 * depositBond, show reads the free bond, and withdraw takes part of it back.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Subprocess, spawn, spawnSync } from "bun";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  defineChain,
  encodeFunctionData,
  encodeFunctionResult,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { escrowAbi } from "../../rail/src/escrow/abi.ts";
import { TERMS_ABI, parseBondArgs, runBond, setTermsArgs } from "../src/bond.ts";

const ROOT = join(import.meta.dir, "../../..");
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const SELLER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

const port = 20_000 + Math.floor(Math.random() * 20_000);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: deployer });
const tokenAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

let anvil: Subprocess;
let token: Address;
let escrowAddr: Address;

function artifact(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  return json.bytecode.object as Hex;
}

async function deploy(bytecode: Hex, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> {
  const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function bondOf(): Promise<bigint> {
  return pub.readContract({
    address: escrowAddr,
    abi: escrowAbi,
    functionName: "bondOf",
    args: [seller.address],
  });
}

beforeAll(async () => {
  const build = spawnSync(["forge", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(`forge build failed: ${build.stderr.toString()}`);
  anvil = spawn(["anvil", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; ; i++) {
    try {
      await pub.getChainId();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await Bun.sleep(100);
    }
  }
  token = await deploy(artifact("MockEIP3009.sol", "MockEIP3009"), [{ type: "constructor", inputs: [] }], []);
  escrowAddr = await deploy(artifact("CountersignedEscrow.sol", "CountersignedEscrow"), escrowAbi, [
    token,
    "0x000000000000000000000000000000000000dEaD",
    100,
    deployer.address,
  ]);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "mint",
      args: [seller.address, 10_000_000n],
    }),
  });
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

describe("bond commands on anvil", () => {
  test("deposit signs the authorisation, show prints the free bond, withdraw takes part back", async () => {
    const deposit: string[] = [];
    await runBond(
      parseBondArgs(["deposit", "500000", "--escrow", escrowAddr, "--rpc", rpcUrl]),
      SELLER_KEY,
      (line) => deposit.push(line),
    );
    expect(deposit[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await bondOf()).toBe(500_000n);

    // A second deposit uses a fresh random salt and credits exactly its amount.
    const second: string[] = [];
    await runBond(
      parseBondArgs(["deposit", "250000", "--escrow", escrowAddr, "--rpc", rpcUrl]),
      SELLER_KEY,
      (line) => second.push(line),
    );
    expect(second[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(second[0]).not.toBe(deposit[0]);
    expect(await bondOf()).toBe(750_000n);

    const show: string[] = [];
    await runBond(
      parseBondArgs(["show", "--escrow", escrowAddr, "--rpc", rpcUrl]),
      SELLER_KEY,
      (line) => show.push(line),
    );
    expect(show).toEqual(["750000"]);

    const withdraw: string[] = [];
    await runBond(
      parseBondArgs(["withdraw", "200000", "--escrow", escrowAddr, "--rpc", rpcUrl]),
      SELLER_KEY,
      (line) => withdraw.push(line),
    );
    expect(withdraw[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await bondOf()).toBe(550_000n);
  }, 30_000);

  test("parsing refuses a missing escrow, a zero amount and an unknown flag", () => {
    expect(() => parseBondArgs(["deposit", "500000"])).toThrow("--escrow is required.");
    expect(() => parseBondArgs(["deposit", "0", "--escrow", escrowAddr])).toThrow("The amount must be positive.");
    expect(() => parseBondArgs(["show", "--escrow", escrowAddr, "--nope"])).toThrow("Unknown argument --nope.");
  });

  test("--rpc defaults to the Arc testnet and --token-name/version override the domain", () => {
    const command = parseBondArgs(["show", "--escrow", escrowAddr]);
    expect(command.rpcUrl).toBe("https://rpc.testnet.arc.network");
    expect(command.tokenName).toBe("USDC");
    expect(command.tokenVersion).toBe("2");

    const overridden = parseBondArgs([
      "show",
      "--escrow",
      escrowAddr,
      "--token-name",
      "Tether USD",
      "--token-version",
      "1",
    ]);
    expect(overridden.tokenName).toBe("Tether USD");
    expect(overridden.tokenVersion).toBe("1");
  });
});

describe("bond terms", () => {
  const offer = `0x${"aa".repeat(32)}` as Hex;
  const termsArgs = (over: { price?: string; bond?: string; reviewWindow?: string } = {}) => [
    "terms",
    "--offer",
    offer,
    "--price",
    over.price ?? "500000",
    "--bond",
    over.bond ?? "250000",
    "--review-window",
    over.reviewWindow ?? "600",
    "--min-duration",
    "120",
    "--escrow",
    escrowAddr,
  ];

  test("encodes setTerms with exactly the five arguments, from the seller's key", async () => {
    const command = parseBondArgs(termsArgs());
    expect(command.command).toBe("terms");
    if (command.command !== "terms") throw new Error("expected a terms command");

    const encoded = encodeFunctionData({ abi: TERMS_ABI, functionName: "setTerms", args: setTermsArgs(command) });
    const decoded = decodeFunctionData({ abi: TERMS_ABI, data: encoded });
    expect(decoded.functionName).toBe("setTerms");
    expect(decoded.args).toEqual([offer, 500_000n, 250_000n, 600n, 120n]);

    let captured: { escrow: Address; args: readonly unknown[] } | undefined;
    const log: string[] = [];
    await runBond(command, SELLER_KEY, (line) => log.push(line), {
      writeTerms: async (escrow, args) => {
        captured = { escrow, args };
        return `0x${"ab".repeat(32)}`;
      },
    });
    expect(captured?.escrow.toLowerCase()).toBe(escrowAddr.toLowerCase());
    expect(captured?.args).toEqual([offer, 500_000n, 250_000n, 600n, 120n]);
    expect(log).toEqual([`0x${"ab".repeat(32)}`]);
  });

  test("refuses a bond above the price and a review window over 86400 seconds before any call", async () => {
    let calls = 0;
    const writeTerms = async (): Promise<Hex> => {
      calls++;
      return `0x${"ab".repeat(32)}`;
    };
    expect(() => parseBondArgs(termsArgs({ bond: "500001" }))).toThrow("bond cannot be more than the price");
    expect(() => parseBondArgs(termsArgs({ reviewWindow: "86401" }))).toThrow(
      "review window cannot be more than 86400 seconds",
    );
    // A command built past the parser is refused by runBond itself, still before the writer.
    const parsed = parseBondArgs(termsArgs());
    if (parsed.command !== "terms") throw new Error("expected a terms command");
    const over = { ...parsed, bond: 600_000n };
    await expect(runBond(over, SELLER_KEY, () => {}, { writeTerms })).rejects.toThrow(
      "bond cannot be more than the price",
    );
    expect(calls).toBe(0);
  });

  test("refuses a missing escrow and a malformed offer", () => {
    expect(() =>
      parseBondArgs(["terms", "--offer", offer, "--price", "1", "--bond", "0", "--review-window", "0", "--min-duration", "60"]),
    ).toThrow("--escrow is required");
    expect(() => parseBondArgs(["terms", "--offer", "0x01", "--show", "--escrow", escrowAddr])).toThrow(
      "--offer must be a 32-byte hex offer hash",
    );
  });

  test("refuses a --min-duration under 60 seconds, which would let a buyer force a default (cs-w1 on 9240aec)", () => {
    const args = termsArgs();
    const at = args.indexOf("--min-duration");
    const short = [...args];
    short[at + 1] = "59";
    expect(() => parseBondArgs(short)).toThrow("--min-duration must be at least 60 seconds");
    const floor = [...args];
    floor[at + 1] = "60";
    expect(parseBondArgs(floor).command).toBe("terms");
  });

  test("--show decodes termsOf for the seller", async () => {
    const result = encodeFunctionResult({
      abi: TERMS_ABI,
      functionName: "termsOf",
      result: { price: 500_000n, bond: 25_000n, reviewWindow: 600n, minDuration: 120n },
    });
    const methods: string[] = [];
    const transport = custom({
      async request({ method }) {
        methods.push(method);
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_call") return result;
        throw new Error(`unexpected RPC method ${method}`);
      },
    });
    const log: string[] = [];
    await runBond(
      parseBondArgs(["terms", "--show", "--offer", offer, "--escrow", escrowAddr]),
      SELLER_KEY,
      (line) => log.push(line),
      { transport },
    );
    expect(methods).toContain("eth_call");
    expect(JSON.parse(log[0] as string)).toEqual({ price: "500000", bond: "25000", reviewWindow: 600, minDuration: 120 });
  });
});
