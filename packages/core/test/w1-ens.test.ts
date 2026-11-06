import { afterAll, describe, expect, test } from "bun:test";
import { encodeErrorResult, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { sepoliaEnsResolver } from "../src/ens.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// The hub resolves a seller's ENS name when an offer is published; any key can publish. A name
// whose resolver answers with an OffchainLookup (CCIP-Read) points the resolver client at a URL the
// name's owner chose. The lookup must not make the hub fetch that URL.

const offchainLookup = parseAbi([
  "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
]);

const realFetch = globalThis.fetch;
const seen: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
afterAll(() => {
  globalThis.fetch = realFetch;
  servers.forEach((s) => s.stop(true));
});

describe("W1 B13: an ENS lookup follows the name owner's gateway URL", () => {
  test("resolving a name does not fetch a URL named by the resolver", async () => {
    const universal = sepolia.contracts.ensUniversalResolver.address;
    const data = encodeErrorResult({
      abi: offchainLookup,
      errorName: "OffchainLookup",
      args: [universal, ["http://169.254.169.254/latest/meta-data/{sender}/{data}"], "0x1234", "0x12345678", "0x"],
    });
    const node = Bun.serve({
      port: 0,
      async fetch(req) {
        const { id, method } = (await req.json()) as { id: number; method: string };
        if (method === "eth_call") {
          return Response.json({ jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted", data } });
        }
        return Response.json({ jsonrpc: "2.0", id, result: "0x" + sepolia.id.toString(16) });
      },
    });
    servers.push(node);
    const nodeUrl = `http://127.0.0.1:${node.port}`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(nodeUrl)) {
        seen.push(url);
        return new Response("{}", { status: 500 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const resolve = sepoliaEnsResolver({ rpcUrl: nodeUrl, cacheMs: 0 });
    const answer = await resolve("attacker.eth").catch(() => "threw");

    expect(seen.filter((u) => u.includes("169.254.169.254"))).toEqual([]);
    // A name that needs offchain data is unresolved: the hub answers ens-unresolved.
    expect(answer).toBeNull();
  });
});
