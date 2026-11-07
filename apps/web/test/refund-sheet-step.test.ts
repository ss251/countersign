import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stepSheet, type DialogLike } from "../src/routes/merchant/sheet-step.ts";

/**
 * cs-e2e 02:21:26Z (the captain's booth refund): with the desk's Refund sheet open as a MODAL dialog, the top layer
 * made the page inert, so elementFromPoint at Privy's "Sign and continue" returned dialog.mx-sheet. This models that
 * hit-test: a modal dialog wins every point (everything outside it is inert); otherwise the highest z-index wins.
 */
const css = readFileSync(new URL("../src/routes/merchant/merchant.css", import.meta.url), "utf8");
const zOf = (selector: string) => {
  const block = css.slice(css.indexOf(`${selector} {`));
  const z = /z-index:\s*(\d+)/.exec(block.slice(0, block.indexOf("}")));
  if (!z) throw new Error(`no z-index for ${selector}`);
  return Number(z[1]);
};
const PRIVY_Z = 999999; // @privy-io/react-auth's dialog
const SHELL_MAX_Z = 100; // the console's highest layer (shell.css)

function fakeDialog() {
  const calls: string[] = [];
  const d: DialogLike & { modal: boolean; calls: string[] } = {
    open: false,
    modal: false,
    calls,
    matches: (selector) => selector === ":modal" && d.open && d.modal,
    close: () => {
      calls.push("close");
      d.open = false;
      d.modal = false;
    },
    show: () => {
      calls.push("show");
      d.open = true;
      d.modal = false;
    },
    showModal: () => {
      calls.push("showModal");
      d.open = true;
      d.modal = true;
    },
  };
  return d;
}

/** What a click at the centre of Privy's button reaches, the way the browser decides it. */
function hitAtPrivyButton(d: ReturnType<typeof fakeDialog>, stepped: boolean): string {
  if (d.open && d.modal) return "dialog.mx-sheet";
  const layers = [
    { name: "privy: Sign and continue", z: PRIVY_Z },
    ...(d.open ? [{ name: "dialog.mx-sheet", z: stepped ? zOf(".mx-sheet[data-stepped]") : 0 }] : []),
    ...(stepped ? [{ name: "veil", z: zOf(".mx-sheet__veil") }] : []),
  ];
  return layers.sort((a, b) => b.z - a.z)[0]!.name;
}

describe("the refund sheet and the wallet prompt (cs-e2e 02:21:26Z)", () => {
  test("open and idle the sheet is modal; while locked Privy's button is the top hit; unlocked it is modal again", () => {
    const d = fakeDialog();
    d.showModal(); // the sheet opens, as before
    expect(stepSheet(d, false)).toBeNull();
    expect(hitAtPrivyButton(d, false)).toBe("dialog.mx-sheet"); // the bug's shape, while nothing is in flight

    expect(stepSheet(d, true)).toBe("non-modal"); // Sign: the signature is in flight
    expect(d.matches(":modal")).toBe(false);
    expect(d.open).toBe(true);
    expect(hitAtPrivyButton(d, true)).toBe("privy: Sign and continue");
    expect(stepSheet(d, true)).toBeNull(); // the send that follows keeps it non-modal

    expect(stepSheet(d, false)).toBe("modal"); // Refunded or failed: back to a modal sheet
    expect(d.matches(":modal")).toBe(true);
    expect(d.calls).toEqual(["showModal", "close", "show", "close", "showModal"]);
  });

  test("a closed sheet is left alone", () => {
    const d = fakeDialog();
    expect(stepSheet(d, true)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  test("the stepped sheet and its veil sit above the console and below Privy, and a swap replays no entrance", () => {
    const veil = zOf(".mx-sheet__veil");
    const sheet = zOf(".mx-sheet[data-stepped]");
    expect(veil).toBeGreaterThan(SHELL_MAX_Z);
    expect(sheet).toBeGreaterThan(veil);
    expect(sheet).toBeLessThan(PRIVY_Z);
    expect(css).toMatch(/\.mx-sheet\[data-swapped\]:not\(\[data-closing\]\) \{\s*animation: none;/);
  });

  test("the Sheet steps with locked, the flag WalletRefund sets while the signature and the send are in flight", () => {
    const panel = readFileSync(new URL("../src/routes/merchant/Panel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("const did = stepSheet(dialog, locked);");
    expect(panel).toContain("}, [locked]);");
    expect(panel).toContain('{stepped ? <div className="mx-sheet__veil" aria-hidden="true"');
    const refund = readFileSync(new URL("../src/routes/merchant/WalletRefund.tsx", import.meta.url), "utf8");
    expect(refund).toMatch(/locked=\{busy\}/);
  });
});
