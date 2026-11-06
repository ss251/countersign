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

export async function signIn(page: Page, email: string, otp: string): Promise<void> {
  const box = dialog(page);
  await expect(box).toBeVisible({ timeout: 30_000 });

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
