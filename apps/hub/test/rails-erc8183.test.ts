import { describe, expect, test } from "bun:test";
import { railsFromEnv } from "../src/rails.ts";

const ESCROW = "0x7777777777777777777777777777777777777777";
const RELAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("the erc8183 rail", () => {
  test("ERC8183_ESCROW and ARC_RPC_URL declare the rail on Arc testnet", async () => {
    const rails = await railsFromEnv({
      ERC8183_ESCROW: ESCROW,
      ARC_RPC_URL: "https://rpc.testnet.arc.invalid",
      CS_RELAYER_KEY: RELAYER_KEY,
    });

    const rail = rails.find((entry) => entry.declaration.id === "erc8183");
    expect(rail).toBeDefined();
    expect(rail!.declaration.network).toBe("eip155:5042002");
    expect(rail!.declaration.kind).toBe("escrow");
    expect(rail!.declaration.scheme).toBe("countersign");
    expect(rail!.declaration.escrow).toBe(ESCROW);
  });

  test("without ERC8183_ESCROW there is no erc8183 rail", async () => {
    const rails = await railsFromEnv({
      ARC_RPC_URL: "https://rpc.testnet.arc.invalid",
      CS_RELAYER_KEY: RELAYER_KEY,
    });

    expect(rails.some((entry) => entry.declaration.id === "erc8183")).toBe(false);
  });
});
