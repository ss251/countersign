import { describe, expect, test } from "bun:test";
import { createHub, type HubDeps } from "../src/app.ts";
import { Store } from "../src/store.ts";

function build(commit?: string) {
  const deps: HubDeps = {
    store: new Store(":memory:"),
    rails: [],
    now: () => 1_700_000_000,
    publicUrl: "http://hub.test",
  };
  if (commit !== undefined) deps.commit = commit;
  return createHub(deps);
}

describe("/healthz commit", () => {
  test("names the commit the hub was deployed from", async () => {
    const commit = "a".repeat(40);
    const { app, runners } = build(commit);
    try {
      const response = await app.request("/healthz");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { commit: string | null };
      expect(body.commit).toBe(commit);
    } finally {
      runners.stop();
    }
  });

  test("is null when the commit is unknown", async () => {
    const { app, runners } = build();
    try {
      const response = await app.request("/healthz");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { commit: string | null };
      expect(body.commit).toBeNull();
    } finally {
      runners.stop();
    }
  });
});
