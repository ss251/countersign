/**
 * Drive the Privy modal. It is third-party DOM, so this only uses roles and input types.
 * Callers take every screenshot, and none while the email or the code is in the page.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

async function firstVisible(candidates: Locator[], timeoutMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      const count = await candidate.count();
      for (let i = 0; i < count; i++) {
        const item = candidate.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    await pageWait(250);
  }
  throw new Error("no matching Privy element appeared");
}

function pageWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Privy's dialog wrapper can be zero-size, so the role only scopes its contents. */
function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/** The modal's own content, which is visible even when the dialog wrapper is not. */
function modalContent(page: Page): Locator {
  return page
    .locator("#privy-modal-content")
    .or(page.getByRole("heading", { name: /log in or sign up/i }))
    .first();
}

/** Whether Privy's modal content is visible within `timeoutMs`; a timeout is not an error. */
export async function dialogVisible(page: Page, timeoutMs: number): Promise<boolean> {
  return modalContent(page)
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Wait until Privy's content is gone. Its dialog wrapper can be zero-size, so a hidden role is
 * not proof that the content left the screen.
 */
export async function waitForModalClosed(page: Page, timeoutMs: number): Promise<void> {
  const content = page.locator("#privy-modal-content");
  const prompt = page.getByText(/enter confirmation code|log in or sign up/i);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await anyVisible(content)) && !(await anyVisible(prompt))) return;
    if (Date.now() >= deadline) break;
    await pageWait(250);
  }
  throw new Error(`Privy's modal did not close within ${timeoutMs / 1000} s`);
}

export const PRIVY_SECOND_CLICK_NOTE =
  "Privy needed a second click: the first came before it was ready (UX gap, cs-ui)";

export interface PrivyAttempt {
  clickSignIn(): Promise<void>;
  clickMenu(): Promise<void>;
  dialogVisible(): Promise<boolean>;
  /** False when something covers the menu, such as the backdrop of a modal that opened late. */
  menuUsable?(): Promise<boolean>;
  note(text: string): void;
}

/**
 * Click sign-in and retry once when Privy's dialog does not appear. The first click can land
 * before Privy's SDK is ready, and Privy drops it silently.
 */
export async function openPrivy(attempt: PrivyAttempt): Promise<void> {
  await attempt.clickSignIn();
  if (await attempt.dialogVisible()) return;
  if (attempt.menuUsable && !(await attempt.menuUsable())) return;
  await attempt.clickMenu();
  await attempt.clickSignIn();
  attempt.note(PRIVY_SECOND_CLICK_NOTE);
}

function privyHost(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    return host.endsWith("privy.io") ? host : undefined;
  } catch {
    return undefined;
  }
}

/** Count a privy.io response only when it is a server error. */
export function recordPrivyResponse(failures: string[], url: string, status: number): void {
  if (status < 500) return;
  const host = privyHost(url);
  if (host) failures.push(`${host} ${status}`);
}

/** Count a failed privy.io request unless the browser aborted it itself. */
export function recordPrivyRequestFailure(failures: string[], url: string, errorText: string | undefined): void {
  if (errorText?.includes("ERR_ABORTED")) return;
  const host = privyHost(url);
  if (host) failures.push(`${host} ${errorText ?? "failed"}`);
}

export async function signIn(
  page: Page,
  email: string,
  otp: string,
  beforeTyping?: () => Promise<void>,
): Promise<void> {
  const box = dialog(page);
  if (!(await dialogVisible(page, 30_000))) throw new Error("Privy's modal did not open");
  await beforeTyping?.();

  const emailInput = await firstVisible(
    [
      box.getByPlaceholder(/email/i),
      box.locator('input[type="email"]'),
      box.getByRole("textbox"),
    ],
    30_000,
  );
  await emailInput.fill(email);
  await emailInput.press("Enter");

  const code = await firstVisible(
    [box.locator('input[autocomplete="one-time-code"]'), box.locator('input[inputmode="numeric"]')],
    60_000,
  );
  await code.focus();
  await page.keyboard.type(otp, { delay: 50 });

  await expect(page.locator('[data-testid="wallet-address"]')).toHaveAttribute(
    "data-value",
    /^0x[0-9a-fA-F]{40}$/,
    { timeout: 120_000 },
  );
}

/**
 * Record every console message and page error in a local text artifact, one JSON line per entry.
 * Only what the page logged, never a request or response body.
 */
export function recordPrivyConsole(page: Page, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
  const write = (type: string, text: string): void => {
    appendFileSync(file, `${JSON.stringify({ type, text: text.slice(0, 500) })}\n`);
  };
  page.on("console", (message) => write(message.type(), message.text()));
  page.on("pageerror", (error) => write("pageerror", error.message));
}

const SIGN_BUTTON = /^(sign|approve|confirm)/i;
const SIGN_ERROR = /an error has occurred|please try again/i;
const SIGN_CLICK_LIMIT = 3;
const PROMPT_POLL_MS = 250;
const PROMPT_OUTCOME_MS = 15_000;
const SIGN_RETRY_MS = 2_000;
const SIGN_CLICK_MS = 5_000;

export const PRIVY_SIGN_FAILURE =
  'Privy could not sign: "An error has occurred, please try again" after 3 tries';

export function privySignatureNote(clicks: number): string {
  return `Privy's signature needed ${clicks} clicks: "An error has occurred, please try again" (UX gap, cs-ui)`;
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function enabled(locator: Locator): Promise<boolean> {
  return locator.isEnabled().catch(() => false);
}

async function anyVisible(locator: Locator): Promise<boolean> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    if (await visible(locator.nth(i))) return true;
  }
  return false;
}

/** Run 20261106-191537-56ca: a disabled sign button is Privy at work, not a prompt waiting for a person. */
async function readySignButton(page: Page): Promise<Locator | undefined> {
  const buttons = page.getByRole("dialog").getByRole("button", { name: SIGN_BUTTON });
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if ((await visible(button)) && (await enabled(button))) return button;
  }
  return undefined;
}

/** Click only a ready button; a click that loses its prompt is treated as no prompt. */
async function clickIfReady(button: Locator): Promise<boolean> {
  if (!(await visible(button)) || !(await enabled(button))) return false;
  try {
    await button.click({ timeout: SIGN_CLICK_MS });
    return true;
  } catch (error) {
    if (!(await visible(button)) || !(await enabled(button))) return false;
    throw error;
  }
}

type PromptOutcome = "closed" | "error" | "open";

/** Watch one prompt until it closes, shows Privy's error, or stays open for fifteen seconds. */
async function waitForPromptOutcome(page: Page, box: Locator, button: Locator): Promise<PromptOutcome> {
  const error = box.getByText(SIGN_ERROR);
  for (let waited = 0; waited < PROMPT_OUTCOME_MS; waited += PROMPT_POLL_MS) {
    if (!(await visible(button))) return "closed";
    if (await anyVisible(error)) return "error";
    await page.waitForTimeout(PROMPT_POLL_MS);
  }
  if (!(await visible(button))) return "closed";
  return (await anyVisible(error)) ? "error" : "open";
}

/**
 * Approve a signature dialog if one appears within ten seconds. Privy can leave its "An error has
 * occurred, please try again" message over an active button, so retry that button twice more.
 * Returns the number of clicks the prompt took, or zero when no prompt appeared.
 */
export async function approveIfPrompted(page: Page, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const box = page.getByRole("dialog");
  while (Date.now() < deadline) {
    const button = await readySignButton(page);
    if (button) {
      let clicks = 0;
      for (;;) {
        if (!(await clickIfReady(button))) {
          if (clicks > 0) return clicks;
          break;
        }
        clicks += 1;
        const outcome = await waitForPromptOutcome(page, box, button);
        if (outcome !== "error") return clicks;
        if (clicks >= SIGN_CLICK_LIMIT) throw new Error(PRIVY_SIGN_FAILURE);
        await page.waitForTimeout(SIGN_RETRY_MS);
        if (!(await visible(button))) return clicks;
      }
    }
    await page.waitForTimeout(250);
  }
  return 0;
}
