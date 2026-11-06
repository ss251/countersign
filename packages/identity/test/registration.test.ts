import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { REGISTRATION_TYPE, registrationFile, toDataUri } from "../src/index.ts";

const seller = "0x1111111111111111111111111111111111111111" as Address;
const offers = [
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
] as Hex[];
const hub = "https://hub.example";

const file = registrationFile({
  name: "Slipwright",
  description: "Writes slips.",
  hubUrl: hub,
  seller,
  offers,
});

describe("registration file", () => {
  test("names the type, the endpoints and the offers", () => {
    expect(file.type).toBe(REGISTRATION_TYPE);
    expect(file.name).toBe("Slipwright");
    expect(file.description).toBe("Writes slips.");
    expect(file.endpoints).toEqual([
      { name: "A2A", endpoint: `${hub}/.well-known/agent-card.json` },
      { name: "agentWallet", endpoint: `eip155:5042002:${seller}` },
    ]);
    expect(file.supportedTrust).toEqual(["reputation"]);
    expect(file.offers).toEqual(offers);
  });

  test("the data URI round-trips to the same JSON", () => {
    const uri = toDataUri(file);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const base64 = uri.slice("data:application/json;base64,".length);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const back = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    expect(back).toEqual(file);
  });
});

test("the agentWallet endpoint names the chain the identity lives on", () => {
  const onHedera = registrationFile({
    name: "seller",
    description: "on Hedera testnet",
    hubUrl: "https://hub.example",
    seller: "0x00000000000000000000000000000000000000aa",
    offers: [],
    chainId: 296,
  });
  expect(onHedera.endpoints.find((e) => e.name === "agentWallet")?.endpoint).toBe(
    "eip155:296:0x00000000000000000000000000000000000000aa",
  );
});
