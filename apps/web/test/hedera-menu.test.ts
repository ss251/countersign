import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { HederaAccountLine } from "../src/ui/WalletButton.tsx";

/** React separates adjacent text values with comment markers; the words themselves are what matter. */
const plain = (html: string): string => html.replace(/<!--[^>]*-->/g, "");

function line(account: { accountId: string; usdc: string } | null): string {
  return plain(renderToString(createElement(HederaAccountLine, { account })));
}

describe("the sign-in menu's Hedera line", () => {
  test("a 200 shows the account, a Copy button and the Testnet faucet", () => {
    const html = line({ accountId: "0.0.9185802", usdc: "0.50" });
    expect(html).toContain("Hedera account");
    expect(html).toContain("0.0.9185802");
    expect(html).toContain("0.50 USDC");
    expect(html).toContain('aria-label="Copy Hedera account"');
    expect(html).toContain('href="https://faucet.circle.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Fund on faucet.circle.com (Hedera Testnet)");
  });

  test("a 404 adds nothing new", () => {
    expect(line(null)).toBe("");
  });
});
