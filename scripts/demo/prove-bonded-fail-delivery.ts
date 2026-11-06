#!/usr/bin/env bun
/**
 * The bonded failDelivery proof on a deployed CountersignedEscrow v2.1, run by script rather than through the hub.
 *
 * 1. The payee registers bonded terms for an offer and deposits its bond with an EIP-3009 authorisation it signs.
 * 2. The buyer countersigns: an EIP-3009 ReceiveWithAuthorization to the escrow whose nonce is the job id.
 * 3. The arbiter (the hub's relayer) funds the job with the payee's Lock naming it as the one funder. This is the
 *    path the hub takes when it opens a bonded job.
 * 4. The payee delivers nothing, and the arbiter's failDelivery pays the buyer the amount plus the bond.
 *
 * Keys come from the environment only, never the command line: PAYEE_KEY, BUYER_KEY, ARBITER_KEY, and optionally
 * TOPUP_KEY with TOPUP (atomic units sent to the payee first, for its bond and gas).
 * Also: ESCROW, RPC_URL, CHAIN_ID; optionally PRICE and BOND (atomic, 10000 each by default) and OUT (a JSON path).
 */
import { writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
  encodePacked,
  http,
  keccak256,
  parseAbi,
  parseSignature,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function key(name: string): Hex {
  return `0x${env(name).replace(/^0x/, "")}`;
}

const escrow = env("ESCROW") as Address;
const rpcUrl = env("RPC_URL");
const chainId = Number(env("CHAIN_ID"));
const price = BigInt(process.env.PRICE ?? "10000");
const bond = BigInt(process.env.BOND ?? "10000");
const REVIEW_WINDOW = 60n;
const MIN_DURATION = 60n;
const FAILED = 4;

const chain = defineChain({
  id: chainId,
  name: `chain ${chainId}`,
  nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const transport = http(rpcUrl);
const pub = createPublicClient({ chain, transport });

const escrowAbi = parseAbi([
  "function token() view returns (address)",
  "function arbiter() view returns (address)",
  "function domainSeparator() view returns (bytes32)",
  "function LOCK_TYPEHASH() view returns (bytes32)",
  "function BOND_DEPOSIT_TYPEHASH() view returns (bytes32)",
  "function bondOf(address) view returns (uint256)",
  "function bondOfJob(bytes32) view returns (uint256)",
  "function jobIdFor(bytes32 offerHash, address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt, uint256 bond, uint64 reviewWindow) view returns (bytes32)",
  "function jobOf(bytes32 jobId) view returns ((address buyer, uint64 deadline, uint8 status, address payee, uint256 amount, bytes32 offerHash, bytes32 slipHash))",
  "function setTerms(bytes32 offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration)",
  "function depositBond(address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s)",
  "function fund(bytes32 offerHash, (address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt, uint256 bond, uint64 reviewWindow, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) cs, bytes lockSig) returns (bytes32)",
  "function failDelivery(bytes32 jobId)",
  "event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond)",
]);
const tokenAbi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
  toHex("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
);

function digest(domain: Hex, structHash: Hex): Hex {
  return keccak256(encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domain, structHash]));
}

/** An EIP-3009 ReceiveWithAuthorization from `from` to the escrow, hashed as the token checks it. */
function authorization(tokenDomain: Hex, from: Address, value: bigint, validBefore: bigint, nonce: Hex): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, escrow, value, 0n, validBefore, nonce],
    ),
  );
  return digest(tokenDomain, structHash);
}

async function vrs(account: PrivateKeyAccount, hash: Hex): Promise<{ v: number; r: Hex; s: Hex; sig: Hex }> {
  const sig = await account.sign({ hash });
  const parsed = parseSignature(sig);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity + 27;
  return { v, r: parsed.r, s: parsed.s, sig };
}

const txs: Record<string, { hash: Hex; block: string }> = {};

async function mined(label: string, hash: Hex): Promise<TransactionReceipt> {
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  txs[label] = { hash, block: receipt.blockNumber.toString() };
  console.log(`${label} ${hash} block ${receipt.blockNumber}`);
  return receipt;
}

async function main(): Promise<void> {
  const payee = privateKeyToAccount(key("PAYEE_KEY"));
  const buyer = privateKeyToAccount(key("BUYER_KEY"));
  const arbiter = privateKeyToAccount(key("ARBITER_KEY"));
  const asPayee = createWalletClient({ account: payee, chain, transport });
  const asArbiter = createWalletClient({ account: arbiter, chain, transport });

  const onchainArbiter = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "arbiter" });
  if (onchainArbiter.toLowerCase() !== arbiter.address.toLowerCase()) throw new Error("ARBITER_KEY is not this escrow's arbiter");
  if (new Set([payee.address, buyer.address, arbiter.address]).size !== 3) throw new Error("payee, buyer and arbiter must differ");
  const token = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "token" });
  const tokenDomain = await pub.readContract({ address: token, abi: tokenAbi, functionName: "DOMAIN_SEPARATOR" });
  const escrowDomain = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "domainSeparator" });
  const balance = (who: Address): Promise<bigint> =>
    pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [who] });

  const topup = BigInt(process.env.TOPUP ?? "0");
  if (process.env.TOPUP_KEY && topup > 0n) {
    const funder = privateKeyToAccount(key("TOPUP_KEY"));
    const asFunder = createWalletClient({ account: funder, chain, transport });
    await mined(
      "topup",
      await asFunder.writeContract({ address: token, abi: tokenAbi, functionName: "transfer", args: [payee.address, topup] }),
    );
  }

  const now = (await pub.getBlock()).timestamp;
  const validBefore = now + 3600n;
  const offerHash = keccak256(toHex(`countersign proof: bonded failDelivery, escrow v2.1, ${now}`));

  // 1. The payee's own terms, then its bond.
  await mined(
    "setTerms",
    await asPayee.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "setTerms",
      args: [offerHash, price, bond, REVIEW_WINDOW, MIN_DURATION],
    }),
  );
  const bondSalt = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [offerHash, "bond"]));
  const depositTypehash = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "BOND_DEPOSIT_TYPEHASH" });
  const bondNonce = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [depositTypehash, payee.address, bond, bondSalt],
    ),
  );
  const b = await vrs(payee, authorization(tokenDomain, payee.address, bond, validBefore, bondNonce));
  await mined(
    "depositBond",
    await asPayee.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "depositBond",
      args: [payee.address, bond, 0n, validBefore, bondSalt, b.v, b.r, b.s],
    }),
  );

  // 2. The buyer's countersignature: the job id is the nonce of its authorisation.
  const deadline = now + 900n;
  const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [offerHash, "job"])));
  const jobId = await pub.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "jobIdFor",
    args: [offerHash, buyer.address, payee.address, price, deadline, salt, bond, REVIEW_WINDOW],
  });
  const c = await vrs(buyer, authorization(tokenDomain, buyer.address, price, validBefore, jobId));

  // 3. The payee's Lock names the arbiter as the one funder.
  const lockTypehash = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "LOCK_TYPEHASH" });
  const lock = await vrs(
    payee,
    digest(
      escrowDomain,
      keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [lockTypehash, jobId, arbiter.address])),
    ),
  );

  // 4. Fund, then fail the delivery that never came.
  const buyerBefore = await balance(buyer.address);
  await mined(
    "fund",
    await asArbiter.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [
        offerHash,
        {
          buyer: buyer.address,
          payee: payee.address,
          amount: price,
          deadline,
          salt,
          bond,
          reviewWindow: REVIEW_WINDOW,
          validAfter: 0n,
          validBefore,
          v: c.v,
          r: c.r,
          s: c.s,
        },
        lock.sig,
      ],
    }),
  );
  const bondLocked = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "bondOfJob", args: [jobId] });
  const failed = await mined(
    "failDelivery",
    await asArbiter.writeContract({ address: escrow, abi: escrowAbi, functionName: "failDelivery", args: [jobId] }),
  );
  const buyerAfter = await balance(buyer.address);
  const job = await pub.readContract({ address: escrow, abi: escrowAbi, functionName: "jobOf", args: [jobId] });

  let paidToBuyer = 0n;
  let event: { amount: bigint; bond: bigint } | null = null;
  for (const log of failed.logs) {
    if (log.address.toLowerCase() === escrow.toLowerCase()) {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "DeliveryFailed") event = { amount: decoded.args.amount, bond: decoded.args.bond };
    } else if (log.address.toLowerCase() === token.toLowerCase()) {
      const decoded = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Transfer" && decoded.args.to.toLowerCase() === buyer.address.toLowerCase()) {
        paidToBuyer += decoded.args.value;
      }
    }
  }

  const ok = job.status === FAILED && event !== null && event.amount === price && event.bond === bond && paidToBuyer === price + bond;
  const result = {
    chainId,
    escrow,
    token,
    jobId,
    offerHash,
    payee: payee.address,
    buyer: buyer.address,
    arbiter: arbiter.address,
    price: price.toString(),
    bond: bond.toString(),
    bondLocked: bondLocked.toString(),
    reviewWindow: REVIEW_WINDOW.toString(),
    minDuration: MIN_DURATION.toString(),
    deadline: deadline.toString(),
    status: job.status,
    deliveryFailed: event === null ? null : { amount: event.amount.toString(), bond: event.bond.toString() },
    paidToBuyer: paidToBuyer.toString(),
    buyerBefore: buyerBefore.toString(),
    buyerAfter: buyerAfter.toString(),
    txs,
    ok,
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.env.OUT) writeFileSync(process.env.OUT, `${JSON.stringify(result, null, 2)}\n`);
  if (!ok) throw new Error("the proof did not hold: see the result above");
}

await main();
