/**
 * 18 · ERC-8004 seller identity on Hedera testnet. The seller of the live MCP offer is registered
 * in the ERC-8004 IdentityRegistry on Hedera's EVM (chain 296). The suite reads the registry
 * directly over Hedera's JSON-RPC relay: who owns the agent id, what its registration file says,
 * whether the hub and offer it names are live, and which wallet it declares. Reads only.
 */

import { createPublicClient, defineChain, getAddress, http, parseAbi, parseAbiItem, type Address } from "viem";
import { ARC, reader } from "../lib/chains.ts";
import { canonicalHash, type Offer } from "@countersign/core";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";

const CHAIN_ID = Number(process.env.E2E_ERC8004_CHAIN ?? 296);
const RPC = process.env.E2E_ERC8004_RPC ?? "https://testnet.hashio.io/api";
const REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
/** The agent id the Hedera seller registered (cs-hd, 06 Nov, tx 0xfd8d…8235). */
const AGENT_ID = BigInt(process.env.E2E_ERC8004_AGENT ?? 158);
const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

const abi = parseAbi([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

interface Registration {
  type?: string;
  name?: string;
  endpoints?: { name: string; endpoint: string }[];
  supportedTrust?: string[];
  offers?: string[];
}

export const erc8004Identity: Flow = {
  name: "erc8004-identity",
  title: "ERC-8004 seller identity on Hedera testnet",
  owner: "cs-hd",
  network: "hedera",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  async run(ctx) {
    const hub = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const client = createPublicClient({
      chain: defineChain({ id: CHAIN_ID, name: "Hedera Testnet", nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }),
      transport: http(RPC, { retryCount: 3, timeout: 20_000 }),
    });

    const owner = await ctx.step("the seller owns its agent id", async () => {
      equal(await client.getChainId(), CHAIN_ID, "the relay answers as Hedera testnet");
      const o = await client.readContract({ address: REGISTRY, abi, functionName: "ownerOf", args: [AGENT_ID] });
      ctx.note(`agent ${AGENT_ID} in ${REGISTRY} on chain ${CHAIN_ID} is owned by ${o}`);
      return getAddress(o);
    });

    const reg = await ctx.step("the registration file is an ERC-8004 v1 file naming a hub and offers", async () => {
      const uri = await client.readContract({ address: REGISTRY, abi, functionName: "tokenURI", args: [AGENT_ID] });
      const m = /^data:application\/json;base64,(.+)$/.exec(uri);
      check(m, `the agent URI is a base64 JSON data URI (it is ${uri.slice(0, 60)}…)`);
      const r = JSON.parse(Buffer.from(m[1] as string, "base64").toString("utf8")) as Registration;
      ctx.save("registration.json", r);
      equal(r.type, REGISTRATION_TYPE, "registration type");
      check(r.supportedTrust?.includes("reputation"), "the file declares reputation trust");
      check(Array.isArray(r.offers) && r.offers.length > 0, "the file names at least one offer");
      return r;
    });

    await ctx.step("the A2A endpoint is this hub's card, and it lists the offer", async () => {
      const a2a = reg.endpoints?.find((e) => e.name === "A2A")?.endpoint;
      check(a2a, "the file has an A2A endpoint");
      equal(a2a, `${hub}/.well-known/agent-card.json`, "A2A endpoint");
      const card = await ctx.http("agent card", a2a);
      equal(card.status, 200, "agent card status");
      const skills = (card.json as { skills?: { id: string }[] }).skills ?? [];
      for (const offer of reg.offers ?? []) {
        check(skills.some((s) => s.id.toLowerCase() === offer.toLowerCase()), `the card lists the registered offer ${offer.slice(0, 10)}`);
      }
    });

    await ctx.step("every registered offer is the owner's and live on the hub", async () => {
      const res = await ctx.http("public offers", `${hub}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: { offerHash: string; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
      for (const hash of reg.offers ?? []) {
        const l = offers.find((x) => x.offerHash.toLowerCase() === hash.toLowerCase());
        check(l, `the hub does not list registered offer ${hash.slice(0, 10)}`);
        sameHex(canonicalHash(l.offer), l.offerHash, `offer ${hash.slice(0, 10)} hashes to its offerHash`);
        equal(getAddress(l.offer.seller), owner, `offer ${hash.slice(0, 10)}'s seller is the agent's owner`);
        equal(l.status, "listed", `offer ${hash.slice(0, 10)} status`);
        equal(l.online, true, `offer ${hash.slice(0, 10)} online`);
      }
    });

    await ctx.step("the declared wallet is the owner, on the chain the identity lives on", async () => {
      const wallet = getAddress(await client.readContract({ address: REGISTRY, abi, functionName: "getAgentWallet", args: [AGENT_ID] }));
      equal(wallet, owner, "the registry's agent wallet");
      const declared = reg.endpoints?.find((e) => e.name === "agentWallet")?.endpoint ?? "";
      const m = /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(declared);
      check(m, `the file's agentWallet endpoint is a CAIP-10 eip155 account (it is "${declared}")`);
      equal(getAddress(m[2] as string), owner, "the file's agentWallet address");
      equal(Number(m[1]), CHAIN_ID, `the file's agentWallet chain (it names eip155:${m[1]}, the identity is registered on eip155:${CHAIN_ID})`);
    });
  },
};

const ARC_REPUTATION: Address = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
/** The first block worth reading on Arc for feedback; the hub's own ERC8004_FROM_BLOCK. */
const ARC_FROM_BLOCK = BigInt(process.env.E2E_ERC8004_ARC_FROM ?? 71029600);
const newFeedback = parseAbiItem(
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
);

/**
 * 18b · ERC-8004 identities and feedback on Arc. Every seller the public hub names with an
 * ERC-8004 agent id must own it on Arc, with a registration file that names this hub and the
 * seller's own offers. Feedback counts only when it is earned: its hash is a slip the hub released
 * for that seller, and the client who gave it is that slip's buyer. Reads only.
 */
export const erc8004Arc: Flow = {
  name: "erc8004-arc",
  title: "ERC-8004 identities and earned feedback on Arc",
  owner: "orch-cs",
  network: "arc",
  // Parked by the firstmate (captain, 19:40 IST) until the hourly suite is green again.
  onDemand: "parked until the suite is green; run it with --flow erc8004-arc",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  async run(ctx) {
    const hub = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const arc = reader(ARC);

    const sellers = await ctx.step("the public hub names sellers with ERC-8004 identities", async () => {
      const res = await ctx.http("sellers", `${hub}/sellers`);
      equal(res.status, 200, "sellers status");
      const list = ((res.json as { sellers?: Array<{ address: string; erc8004?: { agentId?: string; identityRegistry?: string } | null }> }).sellers ?? [])
        .filter((s) => s.erc8004?.agentId);
      check(list.length > 0, "no seller on the public hub carries an ERC-8004 agent id");
      for (const s of list) sameHex(s.erc8004?.identityRegistry ?? "", REGISTRY, `seller ${s.address.slice(0, 10)}'s registry`);
      ctx.note(`agents: ${list.map((s) => `${s.erc8004?.agentId} (${s.address.slice(0, 10)})`).join(", ")}`);
      return list.map((s) => ({ seller: getAddress(s.address), agentId: BigInt(s.erc8004?.agentId as string) }));
    });

    const offersRes = await ctx.http("public offers", `${hub}/offers`);
    const listed = (offersRes.json as { offers?: { offerHash: string; offer: Offer; status: string }[] }).offers ?? [];

    for (const { seller, agentId } of sellers) {
      await ctx.step(`agent ${agentId} is owned by its seller and registers this hub and its offers`, async () => {
        const owner = getAddress(await arc.readContract({ address: REGISTRY, abi, functionName: "ownerOf", args: [agentId] }));
        equal(owner, seller, `agent ${agentId} owner`);
        const uri = await arc.readContract({ address: REGISTRY, abi, functionName: "tokenURI", args: [agentId] });
        const m = /^data:application\/json;base64,(.+)$/.exec(uri);
        check(m, `agent ${agentId}'s URI is a base64 JSON data URI`);
        const r = JSON.parse(Buffer.from(m[1] as string, "base64").toString("utf8")) as Registration;
        equal(r.type, REGISTRATION_TYPE, `agent ${agentId} registration type`);
        equal(r.endpoints?.find((e) => e.name === "A2A")?.endpoint, `${hub}/.well-known/agent-card.json`, `agent ${agentId} A2A endpoint`);
        const wallet = r.endpoints?.find((e) => e.name === "agentWallet")?.endpoint ?? "";
        equal(wallet.toLowerCase(), `eip155:${ARC.chainId}:${seller}`.toLowerCase(), `agent ${agentId} agentWallet`);
        for (const hash of r.offers ?? []) {
          const l = listed.find((x) => x.offerHash.toLowerCase() === hash.toLowerCase());
          check(l, `agent ${agentId} registers offer ${hash.slice(0, 10)}, which the hub does not list`);
          equal(getAddress(l.offer.seller), seller, `offer ${hash.slice(0, 10)}'s seller`);
        }
      });
    }

    await ctx.step("every feedback the reputation registry holds for them is checked, and earned feedback exists", async () => {
      const latest = await arc.getBlockNumber();
      const logs: Array<{ agentId: bigint; client: Address; feedbackHash: string; tx: string }> = [];
      for (let from = ARC_FROM_BLOCK; from <= latest; from += 10_000n) {
        const to = from + 9_999n > latest ? latest : from + 9_999n;
        const chunk = await arc.getLogs({ address: ARC_REPUTATION, event: newFeedback, fromBlock: from, toBlock: to });
        for (const l of chunk) {
          const a = l.args as { agentId?: bigint; clientAddress?: Address; feedbackHash?: string };
          if (a.agentId === undefined || !sellers.some((s) => s.agentId === a.agentId)) continue;
          logs.push({ agentId: a.agentId, client: getAddress(a.clientAddress as Address), feedbackHash: a.feedbackHash as string, tx: l.transactionHash as string });
        }
      }
      ctx.save("feedback.json", logs);
      let earned = 0;
      for (const f of logs) {
        const seller = sellers.find((s) => s.agentId === f.agentId)?.seller;
        const res = await ctx.http(`slip for feedback ${f.feedbackHash.slice(0, 10)}`, `${hub}/slips/${f.feedbackHash}`);
        const slip = res.status === 200 ? (res.json as { body?: { seller?: string; buyer?: string } }) : null;
        const ok = !!slip && getAddress(slip.body?.seller ?? "0x0000000000000000000000000000000000000000") === seller && slip.body?.buyer !== undefined && getAddress(slip.body.buyer) === f.client;
        if (ok) {
          earned += 1;
          ctx.tx("arc", `earned feedback for agent ${f.agentId}`, f.tx);
        } else ctx.note(`feedback ${f.tx.slice(0, 10)} for agent ${f.agentId} is not earned (no slip of this seller bought by its client)`);
      }
      ctx.note(`feedback on Arc for these agents: ${logs.length}, earned ${earned}`);
      check(earned > 0, `no earned feedback for agents ${sellers.map((s) => s.agentId).join(", ")} since block ${ARC_FROM_BLOCK}`);
    });
  },
};
