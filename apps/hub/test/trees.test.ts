import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import type { ErrorBody } from "../src/deps.ts";
import { startHub, type TestHub } from "./support.ts";

const UNKNOWN = `0x${"ab".repeat(32)}` as Hex;

describe("receipt trees", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("an unknown root is a 404", async () => {
    const response = await fetch(`${hub.url}/trees/${UNKNOWN}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("unknown-root");
    expect(body.message).toBe("Refused. That slip is not known.");
  });
});
