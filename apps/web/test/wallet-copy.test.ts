import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WalletAddressCopy } from "../src/ui/WalletCopy.tsx";

/** The captain's ask (firstmate 02:10:53Z): a Copy beside the wallet address in the console header. */
describe("the header's wallet address Copy", () => {
  test("it is the shared copy button, named Copy wallet address", () => {
    const html = renderToString(createElement(WalletAddressCopy, { address: "0xb4ff00000000000000000000000000000000d86a" }));
    expect(html).toContain('class="copy"');
    expect(html).toContain('aria-label="Copy wallet address"');
    expect(html).toContain('type="button"');
  });

  test("the header renders it right after the connected address, with the full address", () => {
    const src = readFileSync(new URL("../src/ui/WalletButton.tsx", import.meta.url), "utf8");
    const at = src.indexOf('data-testid="wallet-address"');
    const copy = src.indexOf("<WalletAddressCopy address={account.address} />");
    expect(at).toBeGreaterThan(0);
    expect(copy).toBeGreaterThan(at);
    expect(src.slice(at, copy)).toContain("{shortAddress(account.address)}");
    expect(src.slice(at, copy)).not.toContain("<button");
  });
});
