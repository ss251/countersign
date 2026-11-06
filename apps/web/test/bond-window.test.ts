import { describe, expect, test } from "bun:test";
import { BOND_NEEDS_WINDOW, bondTermsError, offerPreview, WINDOW_RANGE } from "../src/routes/seller/logic.ts";

// The captain's rule (23:25 IST): a bond implies a review window. The contract (cs-31b), core's assertOffer
// and the hub hold it too; here the seller wizard cannot express a bond without one.
const draft = { title: "use-arc", summary: "s", price: "10000", deadline: 60, rails: ["escrow" as const] };

describe("a bond implies a review window", () => {
  test("no bond needs no window, and a bond needs one", () => {
    expect(bondTermsError(undefined, undefined)).toBeNull();
    expect(bondTermsError("0", 0)).toBeNull();
    expect(bondTermsError("100000", 0)).toBe(BOND_NEEDS_WINDOW);
    expect(bondTermsError("100000", undefined)).toBe(BOND_NEEDS_WINDOW);
    expect(bondTermsError("100000", 60)).toBeNull();
  });

  test("a window is whole seconds from 0 to 86,400", () => {
    expect(bondTermsError("0", 86_401)).toBe(WINDOW_RANGE);
    expect(bondTermsError("0", -1)).toBe(WINDOW_RANGE);
    expect(bondTermsError("0", 1.5)).toBe(WINDOW_RANGE);
  });

  test("the wizard's offer cannot carry a bond without a window", () => {
    expect(() => offerPreview({ ...draft, bond: "100000" })).toThrow(BOND_NEEDS_WINDOW);
    expect(offerPreview({ ...draft, bond: "100000", reviewWindow: 60 })).toMatchObject({ bond: "100000", reviewWindow: 60 });
    // What the wizard builds today: no bond and no window, as the runner publishes.
    const today = offerPreview(draft);
    expect(today.bond).toBe("0");
    expect("reviewWindow" in today).toBe(false);
  });
});
