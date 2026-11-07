import { describe, expect, test } from "bun:test";
import { CONSOLE_ORIGINS, safeConsoleUrl } from "../src/login.ts";

describe("console origins", () => {
  test("a login link on either console origin opens", () => {
    const current = "https://counter-sign.up.railway.app/#/cli-login?code=ABCD-EFGH";

    expect(safeConsoleUrl(current)).toBe(current);
  });

  test("any other origin is printed, never opened", () => {
    // the released old console name is no longer trusted
    expect(
      safeConsoleUrl("https://web-production-a58de.up.railway.app/#/cli-login?code=ABCD-EFGH"),
    ).toBeNull();
    expect(safeConsoleUrl("https://evil.example/#/cli-login?code=ABCD-EFGH")).toBeNull();
    expect(safeConsoleUrl("http://counter-sign.up.railway.app/#/cli-login?code=ABCD-EFGH")).toBeNull();
    expect(
      safeConsoleUrl("https://counter-sign.up.railway.app.evil.example/#/cli-login?code=ABCD-EFGH"),
    ).toBeNull();
    expect(
      safeConsoleUrl("https://counter-sign.up.railway.app@evil.example/#/cli-login?code=ABCD-EFGH"),
    ).toBeNull();
    expect(
      safeConsoleUrl("https://counter-sign.up.railway.app:8443/#/cli-login?code=ABCD-EFGH"),
    ).toBeNull();
  });

  test("CONSOLE_ORIGINS is exactly the two consoles", () => {
    expect([...CONSOLE_ORIGINS]).toEqual(["https://counter-sign.up.railway.app"]);
  });

  test("a single origin argument still works", () => {
    expect(safeConsoleUrl("https://a.example/#/x", "https://a.example")).toBe("https://a.example/#/x");
    expect(safeConsoleUrl("https://b.example/#/x", "https://a.example")).toBeNull();
  });
});
