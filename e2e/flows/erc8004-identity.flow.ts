/**
 * 18 · ERC-8004 seller identity on Hedera testnet. The seller of the live MCP offer is registered
 * in the ERC-8004 IdentityRegistry on Hedera's EVM (chain 296). The suite reads the registry
 * directly over Hedera's JSON-RPC relay: who owns the agent id, what its registration file says,
 * whether the hub and offer it names are live, and which wallet it declares. Reads only.
 */

import { createPublicClient, defineChain, getAddress, http, parseAbi, type Address } from "viem";
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
