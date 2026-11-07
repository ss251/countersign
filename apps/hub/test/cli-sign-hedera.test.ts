import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  AccountUpdateTransaction,
  Hbar,
  NftId,
  Timestamp,
  TokenAssociateTransaction,
  TokenId,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { PrivateKey } from "@hiero-ledger/sdk";
import {
  bytesToHex,
  keccak256,
  recoverPublicKey,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts";
import { createHub, type HubDeps } from "../src/app.ts";
import { CliAuthStore } from "../src/cli-auth/store.ts";
import { offerHash, publishMessage, type Envelope, type ErrorBody, type Offer } from "../src/deps.ts";
import { PRIVY_HEADER, PrivySessionError, type Person, type PrivyVerifier } from "../src/privy.ts";
import { Store } from "../src/store.ts";
import type { TypedDataInput, WalletApi } from "../src/wallets/privy-wallets.ts";
import { FakeRail } from "./fake-rail.ts";
import { NOW } from "./support.ts";

const WALLET_ONE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET_TWO_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const WALLET_ONE = privateKeyToAccount(WALLET_ONE_KEY);
const WALLET_TWO = privateKeyToAccount(WALLET_TWO_KEY);
const WALLET_ONE_ADDRESS = WALLET_ONE.address.toLowerCase();
const WALLET_TWO_ADDRESS = WALLET_TWO.address.toLowerCase();

const USDC_TESTNET = "0.0.429274";
const PAYEE = "0.0.7002";
const FEE_PAYER = "0.0.9185802";
const OTHER = "0.0.7003";
const BUYER = "0.0.7001";
const NODE = AccountId.fromString("0.0.3");
const NODE_TWO = AccountId.fromString("0.0.4");
const OFFER_HASH = `0x${"ab".repeat(32)}` as Hex;
const SELLER_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const SELLER = privateKeyToAccount(SELLER_KEY);

const verifier: PrivyVerifier = {
  async verify(token: string): Promise<Person> {
    if (token === "alice") return { userId: "did:privy:alice", wallets: [] };
    if (token === "bob") return { userId: "did:privy:bob", wallets: [] };
    throw new PrivySessionError("nope");
  },
};

interface RawCall {
  walletId: string;
  hash: Hex;
  signature: Hex;
}

interface WalletCalls {
  created: string[];
  found: string[];
  typed: Array<{ walletId: string; typed: TypedDataInput }>;
  messages: Array<{ walletId: string; message: string }>;
  raw: RawCall[];
}

type FakeWallet = WalletApi & { calls: WalletCalls };

function fakeWallet(): FakeWallet {
  const calls: WalletCalls = { created: [], found: [], typed: [], messages: [], raw: [] };
  const isHedera = (externalId: string): boolean => externalId.startsWith("csh_");
  return {
    calls,
    async createWallet(externalId) {
      calls.created.push(externalId);
      return isHedera(externalId)
        ? { id: "privy-wallet-hedera", address: WALLET_TWO_ADDRESS }
        : { id: "privy-wallet-1", address: WALLET_ONE_ADDRESS };
    },
    async findWallet(externalId) {
      calls.found.push(externalId);
      return isHedera(externalId)
        ? { id: "privy-wallet-hedera", address: WALLET_TWO_ADDRESS }
        : null;
    },
    async signTypedData(walletId, typed) {
      calls.typed.push({ walletId, typed });
      return WALLET_ONE.signTypedData({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      } as never);
    },
    async personalSign(walletId, message) {
      calls.messages.push({ walletId, message });
      return WALLET_ONE.signMessage({ message });
    },
    async rawSign(walletId, hash) {
      const signature = await WALLET_TWO.sign({ hash });
      calls.raw.push({ walletId, hash, signature });
      return signature;
    },
  };
}

interface TestHub {
  url: string;
  store: Store;
  cliStore: CliAuthStore;
  wallets: FakeWallet;
  createAccountCalls: string[];
  setNow: (at: number) => void;
  close: () => void;
}

let hubs: TestHub[] = [];

beforeEach(() => {
  hubs = [];
});

afterEach(() => {
  for (const hub of hubs) hub.close();
  hubs = [];
});

function startHub(options: { hedera?: boolean; hourlyCap?: number } = {}): TestHub {
  const store = new Store(":memory:");
  const wallets = fakeWallet();
  const cliStore = new CliAuthStore(":memory:");
  const createAccountCalls: string[] = [];
  let now = NOW;
  const terms = (hash: string) => {
    const stored = store.getOffer(hash);
    if (stored === null) return null;
    return {
      offerHash: hash,
      asset: USDC_TESTNET,
      amount: BigInt(stored.offer.price),
      payTo: PAYEE,
      feePayer: FEE_PAYER,
    };
  };
  const deps: HubDeps = {
    store,
    rails: [new FakeRail("escrow")],
    now: () => now,
    publicUrl: "http://hub.test",
    privy: verifier,
    cliAuth: {
      store: cliStore,
      wallets,
      consoleUrl: "https://console.test",
      ...(options.hedera === false
        ? {}
        : {
            hedera: {
              terms,
              hourlyCap: options.hourlyCap,
              createAccount: async (compressedPublicKey: string) => {
                createAccountCalls.push(compressedPublicKey);
                return { accountId: BUYER };
              },
            },
          }),
    },
  };
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  const hub: TestHub = {
    url: `http://127.0.0.1:${server.port}`,
    store,
    cliStore,
    wallets,
    createAccountCalls,
    setNow: (at) => {
      now = at;
    },
    close: () => {
      runners.stop();
      server.stop(true);
    },
  };
  hubs.push(hub);
  return hub;
}

function postJson(
  hub: TestHub,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${hub.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function login(hub: TestHub, user = "alice"): Promise<string> {
  const started = (await (
    await postJson(hub, "/cli/login/start", {})
  ).json()) as { code: string; deviceSecret: string };
  await postJson(hub, "/cli/login/approve", { code: started.code }, { [PRIVY_HEADER]: user });
  const polled = (await (
    await postJson(hub, "/cli/login/poll", { deviceSecret: started.deviceSecret })
  ).json()) as { sessionToken: string };
  return polled.sessionToken;
}

async function provision(hub: TestHub, token: string): Promise<{ accountId: string; publicKey: string }> {
  const response = await postJson(hub, "/cli/hedera/account", {}, bearer(token));
  if (response.status !== 200) throw new Error(`provision failed with ${response.status}`);
  return (await response.json()) as { accountId: string; publicKey: string };
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    v: 1,
    seller: SELLER.address,
    title: "Hedera transfer builder",
    summary: "Builds a payment the hub signs.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: NOW,
    ...overrides,
  };
}

async function publishOffer(hub: TestHub, offer: Offer = makeOffer()): Promise<Hex> {
  const hash = offerHash(offer);
  const sig = await SELLER.signMessage({ message: publishMessage(hash) });
  const response = await fetch(`${hub.url}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer, sig }),
  });
  if (response.status !== 201) throw new Error(`publish failed with ${response.status}`);
  return hash;
}

function offerMemo(hash: string): string {
  return `cs1:${hash.slice(2).toLowerCase()}`;
}

interface Build {
  hash?: string;
  from?: string;
  to?: string;
  amount?: bigint;
  asset?: string;
  payer?: string;
  memo?: string;
  hbar?: boolean;
  nft?: boolean;
  approved?: boolean;
  decimals?: number;
  secondToken?: boolean;
  validStart?: number;
  duration?: number;
  scheduled?: boolean;
  nonce?: number;
  nodes?: AccountId[];
}

function build(b: Build = {}): string {
  const hash = b.hash ?? OFFER_HASH;
  const asset = b.asset ?? USDC_TESTNET;
  const amount = b.amount ?? 10_000n;
  const tx = new TransferTransaction();
  if (b.nft) {
    tx.addNftTransfer(new NftId(TokenId.fromString(asset), 1), b.from ?? BUYER, b.to ?? PAYEE);
  } else if (b.approved) {
    tx.addApprovedTokenTransfer(asset, b.from ?? BUYER, -amount);
    tx.addTokenTransfer(asset, b.to ?? PAYEE, amount);
  } else if (b.decimals !== undefined) {
    tx.addTokenTransferWithDecimals(asset, b.from ?? BUYER, -amount, b.decimals);
    tx.addTokenTransferWithDecimals(asset, b.to ?? PAYEE, amount, b.decimals);
  } else {
    tx.addTokenTransfer(asset, b.from ?? BUYER, -amount);
    tx.addTokenTransfer(asset, b.to ?? PAYEE, amount);
  }
  if (b.secondToken) {
    tx.addTokenTransfer("0.0.999999", b.from ?? BUYER, -1);
    tx.addTokenTransfer("0.0.999999", b.to ?? PAYEE, 1);
  }
  if (b.hbar) {
    tx.addHbarTransfer(b.from ?? BUYER, Hbar.fromTinybars(-1));
    tx.addHbarTransfer(b.to ?? PAYEE, Hbar.fromTinybars(1));
  }
  const id = TransactionId.withValidStart(
    AccountId.fromString(b.payer ?? FEE_PAYER),
    Timestamp.fromDate(new Date((b.validStart ?? NOW) * 1000)),
  );
  if (b.scheduled) id.setScheduled(true);
  if (b.nonce !== undefined) id.setNonce(b.nonce);
  tx.setTransactionId(id)
    .setTransactionMemo(b.memo ?? offerMemo(hash))
    .setTransactionValidDuration(b.duration ?? 120)
    .setNodeAccountIds(b.nodes ?? [NODE])
    .freeze();
  return Buffer.from(tx.toBytes()).toString("base64");
}

function frozenOther(kind: "update" | "approve" | "associate"): string {
  const id = TransactionId.withValidStart(
    AccountId.fromString(FEE_PAYER),
    Timestamp.fromDate(new Date(NOW * 1000)),
  );
  const tx =
    kind === "update"
      ? new AccountUpdateTransaction().setAccountId(BUYER)
      : kind === "approve"
        ? new AccountAllowanceApproveTransaction().approveTokenAllowance(USDC_TESTNET, BUYER, PAYEE, 1)
        : new TokenAssociateTransaction().setAccountId(BUYER).setTokenIds([USDC_TESTNET]);
  tx.setTransactionId(id).setNodeAccountIds([NODE]).freeze();
  return Buffer.from(tx.toBytes()).toString("base64");
}

async function signedBuild(hash: string): Promise<string> {
  const tx = Transaction.fromBytes(Buffer.from(build({ hash }), "base64"));
  await tx.sign(PrivateKey.generateECDSA());
  return Buffer.from(tx.toBytes()).toString("base64");
}

function differingBodies(): string {
  const raw = Buffer.from(build({ nodes: [NODE, NODE_TWO] }), "base64");
  const list = proto.TransactionList.decode(raw).transactionList;
  const second = proto.SignedTransaction.decode(list[1]!.signedTransactionBytes!) as proto.SignedTransaction;
  const body = proto.TransactionBody.decode(second.bodyBytes!) as proto.TransactionBody;
  const transfer = body.cryptoTransfer as proto.CryptoTransferTransactionBody;
  const transferList = transfer.tokenTransfers[0] as proto.TokenTransferList;
  const entry = transferList.transfers![0] as proto.AccountAmount;
  entry.isApproval = true;
  second.bodyBytes = proto.TransactionBody.encode(body).finish();
  list[1] = { signedTransactionBytes: proto.SignedTransaction.encode(second).finish() };
  return Buffer.from(proto.TransactionList.encode({ transactionList: list }).finish()).toString("base64");
}

function signRequest(hub: TestHub, token: string, body: unknown): Promise<Response> {
  return postJson(hub, "/cli/sign/hedera", body, bearer(token));
}

function seedEnvelope(hub: TestHub, address: string, overrides: Partial<Envelope> = {}): void {
  const envelope: Envelope = {
    v: 1,
    agent: address as Address,
    cap: "5000000",
    perMerchant: "1000000",
    allowlist: [],
    revoked: false,
    askAbove: "100000",
    ...overrides,
  };
  hub.store.putEnvelopeMirror({
    agent: address,
    envelope,
    spent: { total: "0", bySeller: {} },
    signedAt: NOW,
    sig: "0x",
  });
}

function refusalReason(body: unknown): string | undefined {
  return (body as { reason?: string }).reason;
}

describe("POST /cli/hedera/account", () => {
  test("the session reports no Hedera account before provisioning and one after", async () => {
    const hub = startHub();
    const token = await login(hub);
    const before = (await (
      await fetch(`${hub.url}/cli/session`, { headers: bearer(token) })
    ).json()) as { hedera: unknown };
    expect(before.hedera).toBeNull();
    const created = await provision(hub, token);
    expect(created.accountId).toBe(BUYER);
    const after = (await (
      await fetch(`${hub.url}/cli/session`, { headers: bearer(token) })
    ).json()) as { hedera: unknown };
    expect(after.hedera).toEqual({ accountId: BUYER });
  });

  test("the route is not registered with the flag off", async () => {
    const hub = startHub({ hedera: false });
    const token = await login(hub);
    expect((await postJson(hub, "/cli/hedera/account", {}, bearer(token))).status).toBe(404);
    expect(
      (await signRequest(hub, token, { offerHash: OFFER_HASH, transactionBytes: build() })).status,
    ).toBe(404);
  });
});

describe("POST /cli/sign/hedera", () => {
  test("signs every node body with the second wallet and returns the signed transfer", async () => {
    const hub = startHub();
    const token = await login(hub);
    const provisioned = await provision(hub, token);
    const hash = await publishOffer(hub);

    const unsigned = build({ hash, nodes: [NODE, NODE_TWO] });
    const response = await signRequest(hub, token, { offerHash: hash, transactionBytes: unsigned });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { transactionBytes: string; accountId: string };
    expect(body.accountId).toBe(provisioned.accountId);

    const rawBefore = proto.TransactionList.decode(Buffer.from(unsigned, "base64")).transactionList;
    const returned = TransferTransaction.fromBytes(Buffer.from(body.transactionBytes, "base64"));
    const signed = (
      returned as unknown as { _signedTransactions: { list: proto.SignedTransaction[] } }
    )._signedTransactions.list;
    expect(signed).toHaveLength(2);

    const rawCalls = hub.wallets.calls.raw;
    expect(rawCalls.length).toBe(3);
    for (const [index, entry] of signed.entries()) {
      const bodyBytes = entry.bodyBytes!;
      const before = proto.SignedTransaction.decode(
        rawBefore[index]!.signedTransactionBytes ??
          proto.SignedTransaction.encode({
            bodyBytes: rawBefore[index]!.bodyBytes!,
            sigMap: rawBefore[index]!.sigMap,
          }).finish(),
      );
      expect(Buffer.from(bodyBytes)).toEqual(Buffer.from(before.bodyBytes!));
      const hash = keccak256(bodyBytes);
      const call = rawCalls.find((entry) => entry.hash === hash);
      expect(call).toBeDefined();
      expect(call!.walletId).toBe("privy-wallet-hedera");
      const recovered = await recoverPublicKey({ hash, signature: call!.signature });
      expect(publicKeyToAddress(recovered)).toBe(WALLET_TWO.address);

      const pairs = entry.sigMap?.sigPair ?? [];
      expect(pairs).toHaveLength(1);
      expect(bytesToHex(pairs[0]!.pubKeyPrefix!)).toBe(
        compress(WALLET_TWO.publicKey).toLowerCase() as Hex,
      );
      expect(bytesToHex(pairs[0]!.ECDSASecp256k1!)).toBe(`0x${call!.signature.slice(2, 130).toLowerCase()}`);
    }
    expect(hub.wallets.calls.typed).toHaveLength(0);
    expect(hub.wallets.calls.messages).toHaveLength(0);
  });

  test("refuses a body or a client-supplied hash", async () => {
    const hub = startHub();
    const token = await login(hub);
    await provision(hub, token);
    const hash = await publishOffer(hub);
    const withHash = await signRequest(hub, token, {
      offerHash: hash,
      transactionBytes: build({ hash }),
      hash: `0x${"11".repeat(32)}`,
    });
    expect(withHash.status).toBe(400);
    const noBody = await signRequest(hub, token, { offerHash: hash });
    expect(noBody.status).toBe(400);
    const noSession = await postJson(hub, "/cli/sign/hedera", {
      offerHash: hash,
      transactionBytes: build({ hash }),
    });
    expect(noSession.status).toBe(401);
  });

  test("refuses every transfer that is not exactly the hub's challenge", async () => {
    const hub = startHub();
    const token = await login(hub);
    await provision(hub, token);
    const hash = await publishOffer(hub);

    const cases: Array<{ build?: Build; bytes?: string; reason: string }> = [
      { build: { to: OTHER }, reason: "wrong-payee" },
      { build: { amount: 9_999n }, reason: "amount-mismatch" },
      { build: { asset: "0.0.999999" }, reason: "wrong-asset" },
      { build: { secondToken: true }, reason: "extra-tokens" },
      { build: { nft: true }, reason: "nft-transfers" },
      { build: { hbar: true }, reason: "hbar-transfers" },
      { build: { approved: true }, reason: "approval" },
      { build: { decimals: 8 }, reason: "decimals" },
      { build: { payer: BUYER }, reason: "wrong-fee-payer" },
      { build: { memo: offerMemo(`0x${"cd".repeat(32)}`) }, reason: "wrong-memo" },
      { build: { duration: 181 }, reason: "validity-too-long" },
      { build: { validStart: NOW - 60 }, reason: "expired" },
      { build: { validStart: NOW + 60 }, reason: "not-yet-valid" },
      { build: { scheduled: true }, reason: "scheduled" },
      { build: { nonce: 1 }, reason: "nonce" },
      { bytes: frozenOther("update"), reason: "not-transfer" },
      { bytes: frozenOther("approve"), reason: "not-transfer" },
      { bytes: frozenOther("associate"), reason: "not-transfer" },
      { bytes: await signedBuild(hash), reason: "signed" },
      { bytes: differingBodies(), reason: "body-mismatch" },
    ];
    for (const entry of cases) {
      const response = await signRequest(hub, token, {
        offerHash: hash,
        transactionBytes: entry.bytes ?? build({ hash, ...entry.build }),
      });
      expect(response.status).toBe(403);
      expect(refusalReason(await response.json())).toBe(entry.reason);
    }
  });

  test("refuses over the cap, a closed envelope, and an envelope below the price", async () => {
    const hub = startHub();
    const token = await login(hub);
    await provision(hub, token);

    const hash = await publishOffer(hub);
    const expensive = await publishOffer(hub, makeOffer({ price: "1000001" }));
    const overCap = await signRequest(hub, token, {
      offerHash: expensive,
      transactionBytes: build({ hash: expensive, amount: 1_000_001n }),
    });
    expect(overCap.status).toBe(403);
    expect(refusalReason(await overCap.json())).toBe("over-cap");

    seedEnvelope(hub, WALLET_ONE_ADDRESS, { revoked: true });
    const closed = await signRequest(hub, token, {
      offerHash: hash,
      transactionBytes: build({ hash }),
    });
    expect(closed.status).toBe(403);
    expect(((await closed.json()) as ErrorBody).code).toBe("envelope-closed");

    seedEnvelope(hub, WALLET_ONE_ADDRESS, { perMerchant: "5000" });
    const small = await signRequest(hub, token, {
      offerHash: hash,
      transactionBytes: build({ hash }),
    });
    expect(small.status).toBe(403);
    expect(refusalReason(await small.json())).toBe("over-cap");
  });

  test("refuses an unknown offer, an offer without the hedera rail, and a login with no account", async () => {
    const hub = startHub();
    const token = await login(hub);
    await provision(hub, token);
    const hash = await publishOffer(hub);

    const unknown = await signRequest(hub, token, {
      offerHash: `0x${"ef".repeat(32)}`,
      transactionBytes: build({ hash }),
    });
    expect(unknown.status).toBe(404);

    const escrowOnly = await publishOffer(
      hub,
      makeOffer({ rails: ["escrow"], payTo: undefined }),
    );
    const notOffered = await signRequest(hub, token, {
      offerHash: escrowOnly,
      transactionBytes: build({ hash }),
    });
    expect(notOffered.status).toBe(400);

    const bob = await login(hub, "bob");
    const noAccount = await signRequest(hub, bob, {
      offerHash: hash,
      transactionBytes: build({ hash }),
    });
    expect(noAccount.status).toBe(409);
    expect(((await noAccount.json()) as ErrorBody).code).toBe("no-hedera-account");
  });
});

function compress(uncompressed: Hex): Hex {
  const bytes = Buffer.from(uncompressed.slice(2), "hex");
  const y = BigInt(`0x${bytes.subarray(33).toString("hex")}`);
  return `0x${y % 2n === 0n ? "02" : "03"}${bytes.subarray(1, 33).toString("hex")}` as Hex;
}
