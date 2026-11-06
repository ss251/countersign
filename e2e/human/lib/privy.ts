/**
 * Drive the Privy modal. It is third-party DOM, so this only uses roles and input types.
 * Callers take every screenshot, and none while the email or the code is in the page.
 */

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

function dialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ visible: true }).first();
}

/** Whether Privy's dialog is visible within `timeoutMs`; a timeout is not an error. */
export async function dialogVisible(page: Page, timeoutMs: number): Promise<boolean> {
  return dialog(page)
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

export const PRIVY_SECOND_CLICK_NOTE =
  "Privy needed a second click: the first came before it was ready (UX gap, cs-ui)";

export interface PrivyAttempt {
  clickSignIn(): Promise<void>;
  clickMenu(): Promise<void>;
  dialogVisible(): Promise<boolean>;
  note(text: string): void;
}

/**
 * Click sign-in and retry once when Privy's dialog does not appear. The first click can land
 * before Privy's SDK is ready, and Privy drops it silently.
 */
export async function openPrivy(attempt: PrivyAttempt): Promise<void> {
  await attempt.clickSignIn();
  if (await attempt.dialogVisible()) return;
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
  await expect(box).toBeVisible({ timeout: 30_000 });
  await beforeTyping?.();

  const emailInput = await firstVisible(
    [box.getByRole("textbox", { name: /email/i }), box.locator('input[type="email"]')],
    30_000,
  );
  await emailInput.fill(email);

  const submit = await firstVisible([box.getByRole("button", { name: /submit|continue|log ?in|sign ?in/i })], 30_000);
  await submit.click();

  const code = await firstVisible(
    [page.locator('input[autocomplete="one-time-code"]'), page.locator('input[inputmode="numeric"]')],
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

/** Approve a signature dialog if one appears within ten seconds; otherwise return. */
export async function approveIfPrompted(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const buttons = page.getByRole("dialog").getByRole("button", { name: /^(sign|approve|confirm)/i });
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        return true;
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}
