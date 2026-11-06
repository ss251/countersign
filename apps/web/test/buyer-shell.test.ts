import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { chosenHub, forgetChoices } from "../src/lib/hub.ts";

const AGENT_KEY = "countersign.agent";
const HUB_KEY = "countersign.hub";

const store = new Map<string, string>();

const localStorage = {
  getItem(key: string): string | null {
    return store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    store.set(key, value);
  },
  removeItem(key: string): void {
    store.delete(key);
  },
};

Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });

beforeEach(() => store.clear());

afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("buyer shell: a link's choices are visible and can be dropped", () => {
  test("chosenHub reads the hub stored by a link", () => {
    expect(chosenHub()).toBeNull();
    localStorage.setItem(HUB_KEY, "https://hub.example");
    expect(chosenHub()).toBe("https://hub.example");
  });

  test("forgetChoices removes both the agent and the hub", () => {
    localStorage.setItem(AGENT_KEY, "0x00000000000000000000000000000000000000a1");
    localStorage.setItem(HUB_KEY, "https://hub.example");
    forgetChoices();
    expect(localStorage.getItem(AGENT_KEY)).toBeNull();
    expect(localStorage.getItem(HUB_KEY)).toBeNull();
  });
});

describe("buyer route: the console's desk shell", () => {
  test("exports surface === desk", async () => {
    // The same shape as nav.test.ts's mock: one process shares one module registry, so every mock of routes.ts carries both.
    mock.module(new URL("../src/app/routes.ts", import.meta.url).pathname, () => ({ hasRoute: () => false, VIEWS: [] }));
    const buyer = await import("../src/routes/buyer/index.tsx");
    expect(buyer.surface).toBe("desk");
  });
});
