import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// The same shape as nav.test.ts's and buyer-shell.test.ts's mocks: one process shares one module registry.
mock.module(new URL("../src/app/routes.ts", import.meta.url).pathname, () => ({ hasRoute: () => true, VIEWS: [] }));
const { PhoneLocked } = await import("../src/routes/buyer/Approvals.tsx");

describe("the phone, locked (DESIGN-LOG 12)", () => {
  test("says the approvals are private, shows the token field, and offers Start here, with no dead retry", () => {
    const html = renderToString(createElement(PhoneLocked, { what: "approvals", onOpen: () => {} }));
    expect(html).toContain("Your agent&#x27;s approvals are private.");
    expect(html).toContain("Approval token");
    expect(html).toContain("Use this token");
    expect(html).toContain('href="#/start"');
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("<details");
  });

  test("history locks the same way, in its own words", () => {
    const html = renderToString(createElement(PhoneLocked, { what: "purchases", onOpen: () => {} }));
    expect(html).toContain("Your agent&#x27;s purchases are private.");
  });

  test("a token the hub refused asks for the right one, instead of a dead retry", () => {
    const html = renderToString(createElement(PhoneLocked, { what: "approvals", rejected: true, onOpen: () => {} }));
    expect(html).toContain("This hub did not accept the token on this phone. Paste the right one.");
    expect(html).toContain("Use this token");
    expect(html).not.toContain("Try again");
  });
});
