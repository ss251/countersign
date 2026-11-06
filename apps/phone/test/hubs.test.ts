import { describe, expect, test } from "bun:test";
import { chooseHub, DEFAULT_HUB } from "../src/app/hubs.ts";

describe("which hub the phone talks to", () => {
  test("the built hub by default, and the production hub when nothing was built in", () => {
    expect(chooseHub("", "https://hub.example.test")).toEqual({ hub: "https://hub.example.test", ignored: null });
    expect(chooseHub("", undefined)).toEqual({ hub: DEFAULT_HUB, ignored: null });
  });

  test("a link may point at the same hub, this page's own origin, or this device's loopback", () => {
    expect(chooseHub(`?hub=${DEFAULT_HUB}/`, undefined).hub).toBe(`${DEFAULT_HUB}/`);
    expect(chooseHub("?hub=/hub", undefined).hub).toBe("/hub");
    expect(chooseHub("?hub=http://127.0.0.1:8787", undefined).hub).toBe("http://127.0.0.1:8787");
    expect(chooseHub("?hub=http://localhost:8787", undefined).hub).toBe("http://localhost:8787");
  });

  test("a stranger's hub is refused, because it could ask for this phone's position with nobody paying", () => {
    expect(chooseHub("?hub=https://evil.example", undefined)).toEqual({ hub: DEFAULT_HUB, ignored: "https://evil.example" });
    expect(chooseHub("?hub=//evil.example", undefined).ignored).toBe("//evil.example");
    expect(chooseHub("?hub=javascript:alert(1)", undefined).ignored).toBe("javascript:alert(1)");
    expect(chooseHub("?hub=https://hub-production-e85e.up.railway.app.evil.example", undefined).hub).toBe(DEFAULT_HUB);
  });
});
