import { describe, expect, test } from "bun:test";
import { openPrivy, recordPrivyRequestFailure, recordPrivyResponse } from "../lib/privy.ts";

describe("the Privy outage filter", () => {
  test("ERR_ABORTED is ignored and a 503 counts", () => {
    const failures: string[] = [];

    recordPrivyRequestFailure(failures, "https://auth.privy.io/api/v1/otp", "net::ERR_ABORTED");
    expect(failures).toEqual([]);

    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 503);
    expect(failures).toEqual(["auth.privy.io 503"]);

    recordPrivyRequestFailure(failures, "https://auth.privy.io/api/v1/otp", "net::ERR_CONNECTION_RESET");
    expect(failures).toEqual(["auth.privy.io 503", "auth.privy.io net::ERR_CONNECTION_RESET"]);

    recordPrivyResponse(failures, "https://example.test/api", 503);
    expect(failures).toHaveLength(2);
  });

  test("a healthy response is not an outage", () => {
    const failures: string[] = [];
    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 200);
    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 404);
    expect(failures).toEqual([]);
  });
});

describe("the Privy sign-in click", () => {
  test("a dialog on the first click needs no retry", async () => {
    const calls: string[] = [];
    const notes: string[] = [];

    await openPrivy({
      clickSignIn: async () => {
        calls.push("sign-in");
      },
      clickMenu: async () => {
        calls.push("menu");
      },
      dialogVisible: async () => true,
      note: (text) => notes.push(text),
    });

    expect(calls).toEqual(["sign-in"]);
    expect(notes).toEqual([]);
  });

  test("a dropped first click clicks the menu and the option again, and records the gap", async () => {
    const calls: string[] = [];
    const notes: string[] = [];

    await openPrivy({
      clickSignIn: async () => {
        calls.push("sign-in");
      },
      clickMenu: async () => {
        calls.push("menu");
      },
      dialogVisible: async () => false,
      note: (text) => notes.push(text),
    });

    expect(calls).toEqual(["sign-in", "menu", "sign-in"]);
    expect(notes).toEqual([
      "Privy needed a second click: the first came before it was ready (UX gap, cs-ui)",
    ]);
  });
});
