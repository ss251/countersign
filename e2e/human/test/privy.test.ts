import { describe, expect, test } from "bun:test";
import { recordPrivyRequestFailure, recordPrivyResponse } from "../lib/privy.ts";

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
