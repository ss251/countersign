import { describe, expect, test } from "bun:test";
import { menuOptions } from "../src/ui/WalletButton.tsx";

// cs-e2e, run 20261106-174813-90b8: a click on "Sign in with email or passkey" before Privy reported ready did
// nothing. While Privy starts, its options say so and cannot be pressed; once ready they work.
const noop = () => {};

describe("the wallet menu while Privy starts", () => {
  test("sign-in and the browser wallet wait, and say why", () => {
    const options = menuOptions({ signIn: noop, connectBrowser: noop, injected: true, starting: true });
    expect(options.map((o) => [o.testId, o.label, o.disabled])).toEqual([
      ["wallet-signin", "Loading sign-in…", true],
      ["wallet-connect-injected", "Connect a browser wallet", true],
    ]);
  });

  test("once Privy is ready both can be pressed", () => {
    const options = menuOptions({ signIn: noop, connectBrowser: noop, injected: true, starting: false });
    expect(options.map((o) => [o.label, o.disabled])).toEqual([
      ["Sign in with email or passkey", false],
      ["Connect a browser wallet", false],
    ]);
  });

  test("injected mode never waits: there is no Privy to start", () => {
    const options = menuOptions({ connectBrowser: noop, injected: true, starting: false });
    expect(options.map((o) => o.testId)).toEqual(["wallet-connect-injected"]);
    expect(options[0]!.disabled).toBe(false);
  });

  test("with no browser wallet the link to get one stays a link", () => {
    const options = menuOptions({ signIn: noop, connectBrowser: noop, injected: false, starting: true });
    expect(options[1]).toMatchObject({ label: "No wallet in this browser · Get one", href: "https://metamask.io/download/" });
  });
});
