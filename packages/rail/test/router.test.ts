import { describe, expect, test } from "bun:test";
import type { Offer, RailId } from "@countersign/core";
import { chooseRail, type RailDeclaration, type RailHealth } from "../src/index.ts";

const NOW = 1_700_000_000;
const SELLER = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const ESCROW = "0x4444444444444444444444444444444444444444";
const NETWORK = "eip155:5042002" as const;

function offer(rails: RailId[], price = "10000"): Offer {
  return {
    v: 1,
    seller: SELLER,
    title: "Echo",
    summary: "Echoes.",
    adapter: "skill",
    input: { type: "object" },
    output: { type: "object" },
    price,
    deadline: 120,
    bond: "0",
    rails,
    issuedAt: NOW,
  };
}

function declaration(id: RailId, finalitySeconds: number | undefined, tollBps: number, fixed = "0"): RailDeclaration {
  return {
    id,
    network: NETWORK,
    scheme: "countersign",
    asset: { network: NETWORK, address: USDC, symbol: "USDC", decimals: 6 },
    kind: id === "escrow" ? "escrow" : "direct",
    ...(id === "escrow" ? { escrow: ESCROW } : {}),
    gasPaidBy: "hub",
    finality: "One block after release.",
    explorerTx: "",
    cost: { tollBps, fixed },
    ...(finalitySeconds === undefined ? {} : { finalitySeconds }),
  };
}

const escrow = declaration("escrow", 2, 100);
const gateway = declaration("gateway", 900, 0);
const hedera = declaration("hedera", 5, 0);

describe("chooseRail", () => {
  test("the cheapest acceptable rail wins", () => {
    const choice = chooseRail(offer(["escrow", "gateway"]), {}, [escrow, gateway], {}, NOW);

    expect(choice.chosen).toBe("gateway");
    expect(choice.candidates).toEqual(["gateway", "escrow"]);
    expect(choice.reason).toBe("gateway: cheapest acceptable rail (cost 0, finality 900 s)");
  });

  test("finality over the buyer's maximum makes a rail ineligible", () => {
    const choice = chooseRail(offer(["escrow", "gateway"]), { maxFinalitySeconds: 60 }, [escrow, gateway], {}, NOW);

    expect(choice.chosen).toBe("escrow");
    const entry = choice.trace.find((item) => item.rail === "gateway");
    expect(entry).toEqual({
      rail: "gateway",
      eligible: false,
      cost: "0",
      finalitySeconds: 900,
      why: "finality 900 s is slower than the buyer's 60 s",
    });
  });

  test("buyer rails filter the candidates", () => {
    const choice = chooseRail(offer(["escrow", "hedera"]), { rails: ["hedera"] }, [escrow, hedera], {}, NOW);

    expect(choice.chosen).toBe("hedera");
    expect(choice.candidates).toEqual(["hedera"]);
    expect(choice.trace.map((entry) => [entry.rail, entry.eligible, entry.why])).toEqual([
      ["escrow", false, "the buyer cannot pay it"],
      ["hedera", true, "chosen"],
    ]);
  });

  test("a degraded rail moves behind a costlier healthy one until the window expires", () => {
    const cheap = declaration("escrow", 2, 0);
    const pricey = declaration("gateway", 900, 100);
    const health: Record<string, RailHealth> = { escrow: { failures: 2, lastFailureAt: NOW } };

    const degraded = chooseRail(offer(["escrow", "gateway"]), {}, [cheap, pricey], health, NOW);
    expect(degraded.candidates).toEqual(["gateway", "escrow"]);
    expect(degraded.chosen).toBe("gateway");
    expect(degraded.reason).toBe("gateway: escrow failed twice in the last 10 minutes");

    const expired = chooseRail(offer(["escrow", "gateway"]), {}, [cheap, pricey], health, NOW + 601);
    expect(expired.candidates).toEqual(["escrow", "gateway"]);
    expect(expired.chosen).toBe("escrow");
  });

  test("equal cost and finality are ordered by rail id", () => {
    const a = declaration("gateway", 5, 0);
    const b = declaration("escrow", 5, 0);

    const choice = chooseRail(offer(["gateway", "escrow"]), {}, [a, b], {}, NOW);
    expect(choice.candidates).toEqual(["escrow", "gateway"]);
  });

  test("the whole trace is exact", () => {
    const choice = chooseRail(
      offer(["gateway", "mpp", "escrow", "hedera"]),
      { maxFinalitySeconds: 60, rails: ["gateway", "mpp", "escrow", "hedera"] },
      [gateway, escrow, hedera],
      { escrow: { failures: 2, lastFailureAt: NOW - 10 } },
      NOW,
    );

    expect(choice).toEqual({
      candidates: ["hedera", "escrow"],
      chosen: "hedera",
      reason: "hedera: cheapest acceptable rail (cost 0, finality 5 s)",
      trace: [
        {
          rail: "gateway",
          eligible: false,
          cost: "0",
          finalitySeconds: 900,
          why: "finality 900 s is slower than the buyer's 60 s",
        },
        { rail: "mpp", eligible: false, cost: null, finalitySeconds: null, why: "this hub does not run it" },
        { rail: "escrow", eligible: true, cost: "100", finalitySeconds: 2, why: "fallback 1" },
        { rail: "hedera", eligible: true, cost: "0", finalitySeconds: 5, why: "chosen" },
      ],
    });
  });
});
