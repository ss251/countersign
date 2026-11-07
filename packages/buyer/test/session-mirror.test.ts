import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { shouldMirror } from "../src/buy.ts";
import { isRemoteAccount, remoteAccount } from "../src/remote-signer.ts";

const remote = remoteAccount(
  { token: "t", hub: "https://hub.test", address: "0x1234567890abcdef1234567890abcdef12345678" },
  {
    fetch: Object.assign(async () => new Response("{}", { status: 500 }), { preconnect: () => undefined }),
  },
);
const local = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("session mirror", () => {
  test("a session account is recognised as remote", () => {
    expect(isRemoteAccount(remote)).toBe(true);
    expect(isRemoteAccount(local)).toBe(false);
  });

  test("a signed-in buy skips the ordinary mirror", () => {
    expect(shouldMirror({ mirror: true, agent: remote })).toBe(false);
  });

  test("a key-held buyer still mirrors", () => {
    expect(shouldMirror({ mirror: true, agent: local })).toBe(true);
  });

  test("no mirror without the flag or an agent", () => {
    expect(shouldMirror({ mirror: false, agent: local })).toBe(false);
    expect(shouldMirror({ mirror: true })).toBe(false);
  });

  test("a forced mirror still runs, so a flow that needs it refuses loudly", () => {
    expect(shouldMirror({ force: true, agent: remote })).toBe(true);
  });
});
