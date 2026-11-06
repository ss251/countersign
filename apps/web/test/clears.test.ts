import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ClearsStage, type ClearsProps } from "../src/routes/home/Clears.tsx";

const base: ClearsProps = { envelope: undefined, featured: undefined, release: undefined, others: [], reading: false, pinned: false, narrow: false };
const html = (props: Partial<ClearsProps>) => renderToString(createElement(ClearsStage, { ...base, ...props }));

describe("stage two on a cold load (firstmate, 23:45 IST)", () => {
  test("while the hub's first reads are out it says it is reading, never that no release exists", () => {
    const out = html({ reading: true });
    expect(out).toContain("Reading this hub&#x27;s payments…");
    expect(out).not.toContain("No escrow release on this hub yet");
  });

  test("once the reads are back with no release, it says so plainly", () => {
    expect(html({ reading: false })).toContain("No escrow release on this hub yet");
  });
});
