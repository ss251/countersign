/**
 * One human acceptance run, per project.
 *
 * Every money step is proven on chain: the fund transfer, the escrow fund, the release, and the
 * slip's own verifier. The browser is the console's, driven only by data-testid.
 */

import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  expect,
  test,
  type Locator,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightWorkerArgs,
  type TestInfo,
} from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { ARC, escrowEvents } from "../../lib/chains.ts";
import { raiseIfFailed } from "../lib/failure.ts";
import { approveIfPrompted, recordPrivyRequestFailure, recordPrivyResponse, signIn } from "../lib/privy.ts";
import {
  afterFunding,
  afterPurchase,
  arcClient,
  balanceOf,
  changeToReturn,
  FUND_AMOUNT,
  transfer,
} from "../lib/fund.ts";
import { Keyring } from "../lib/keys.ts";
import { installTestWallet, newTestAccount } from "../lib/wallet.ts";
import {
  currentRunId,
  hubUrl,
  Recorder,
  REPO_ROOT,
  type ProjectStatus,
} from "../lib/report.ts";

const RPC = process.env.E2E_ARC_RPC || ARC.rpc;
const MAX_PRICE = BigInt(process.env.E2E_HUMAN_MAX_PRICE || "50000");

class SkipRun extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SkipRun";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function step<T>(
  rec: Recorder,
  page: Page,
  nn: string,
  slug: string,
  title: string,
  body: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  return test.step(`${nn} ${title}`, async () => {
    try {
      await rec.screenshot(page, nn, slug);
      const value = await body();
      rec.record(`${nn}-${slug}`, "ok", Date.now() - started);
      return value;
    } catch (error) {
      rec.record(`${nn}-${slug}`, error instanceof SkipRun ? "skip" : "fail", Date.now() - started, messageOf(error));
      throw error;
    }
  });
}

async function softStep(
  rec: Recorder,
  page: Page,
  nn: string,
  slug: string,
  title: string,
  body: () => Promise<void>,
): Promise<void> {
  const started = Date.now();
  await test.step(`${nn} ${title}`, async () => {
    try {
      await rec.screenshot(page, nn, slug);
      await body();
      rec.record(`${nn}-${slug}`, "ok", Date.now() - started);
    } catch (error) {
      rec.note(`${nn}-${slug}: ${messageOf(error)}`);
    }
  });
}

function testId(page: Page, testid: string): Locator {
  return page.locator(`[data-testid="${testid}"]`).first();
}

async function waitAttr(page: Page, testid: string, pattern: RegExp, timeoutMs: number, name = "data-value"): Promise<string> {
  const locator = testId(page, testid);
  await expect(locator).toHaveAttribute(name, pattern, { timeout: timeoutMs });
  const value = await locator.getAttribute(name);
  if (value === null) throw new Error(`${testid} has no ${name}`);
  return value;
}

async function waitState(page: Page, testid: string, state: string, timeoutMs: number): Promise<void> {
  await expect(testId(page, testid)).toHaveAttribute("data-state", state, { timeout: timeoutMs });
}

async function pollValue(
  page: Page,
  testid: string,
  ok: (value: string) => boolean,
  timeoutMs: number,
  what = testid,
): Promise<string> {
  const locator = testId(page, testid);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (await locator.isVisible().catch(() => false)) {
      const value = await locator.getAttribute("data-value", { timeout: 1_000 }).catch(() => null);
      if (value !== null) {
        last = value;
        if (ok(value)) return value;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${what} still shows ${last || "nothing"} after ${Math.round(timeoutMs / 1000)} s`);
}

async function refusalText(page: Page): Promise<string | undefined> {
  const locator = testId(page, "buy-refusal");
  if (!(await locator.isVisible().catch(() => false))) return undefined;
  const text = (await locator.innerText().catch(() => "")).trim();
  return text || "the console refused the purchase";
}

async function assertNoRefusal(page: Page): Promise<void> {
  const text = await refusalText(page);
  if (text) throw new Error(text);
}

async function waitStateOrRefusal(page: Page, testid: string, state: string, timeoutMs: number): Promise<void> {
  const locator = testId(page, testid);
  const deadline = Date.now() + timeoutMs;
  let current: string | null = null;
  while (Date.now() < deadline) {
    const refusal = await refusalText(page);
    if (refusal) throw new Error(refusal);
    current = await locator.getAttribute("data-state", { timeout: 1_000 }).catch(() => null);
    if (current === state) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`${testid} is ${current ?? "missing"}, not ${state} after ${Math.round(timeoutMs / 1000)} s`);
}

function watchPrivy(page: Page, failures: string[]): void {
  page.on("response", (response) => {
    recordPrivyResponse(failures, response.url(), response.status());
  });
  page.on("requestfailed", (request) => {
    recordPrivyRequestFailure(failures, request.url(), request.failure()?.errorText);
  });
}

interface Offer {
  item: Locator;
  hash: string;
  price: bigint;
}

async function pickOffer(page: Page, list: Locator): Promise<Offer> {
  const items = list.locator('[data-testid="offer-item"]');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const rail = (await item.getAttribute("data-rail")) ?? "";
      const priceText = (await item.getAttribute("data-price")) ?? "";
      const hash = (await item.getAttribute("data-offer-hash")) ?? "";
      if (rail !== "escrow" || !/^[0-9]+$/.test(priceText) || !/^0x[0-9a-fA-F]{64}$/.test(hash)) continue;
      const price = BigInt(priceText);
      if (price > MAX_PRICE) continue;
      return { item, hash, price };
    }
    await page.waitForTimeout(500);
  }
  throw new Error("no live Arc escrow offer");
}

const runHuman = async (
  { page, context }: PlaywrightTestArgs & PlaywrightWorkerArgs,
  testInfo: TestInfo,
): Promise<void> => {
  const project = testInfo.project.name;
  if (project !== "privy" && project !== "injected") test.skip(true, `unknown project ${project}`);

  const runId = currentRunId();
  const rec = new Recorder(runId, project);
  const keys = new Keyring();
  const client = arcClient(RPC);
  const email = keys.secret("PRIVY_TEST_EMAIL") ?? "";
  const otp = keys.secret("PRIVY_TEST_OTP") ?? "";
  const injected = project === "injected" ? newTestAccount() : undefined;
  const privyFailures: string[] = [];
  let tracing = false;
  let status: ProjectStatus = "FAIL";
  let skipped: SkipRun | undefined;
  let failed = false;
  let failure: unknown;

  if (project === "privy") watchPrivy(page, privyFailures);

  if (project === "privy" && (email === "" || otp === "")) {
    rec.record("00-open", "skip", 0, "no Privy test login");
    rec.write("NOT RUN", { skipReason: "no Privy test login" });
    test.skip(true, "no Privy test login");
  }

  if (injected) {
    await installTestWallet(context, injected, RPC);
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracing = true;
  }

  try {
    await step(rec, page, "00", "open", "open the console", async () => {
      await page.goto("/");
      await expect(testId(page, "wallet-connect")).toBeVisible({ timeout: 30_000 });
    });

    await step(rec, page, "01", "sign-in", "sign in", async () => {
      await testId(page, "wallet-connect").click();
      if (injected) {
        await testId(page, "wallet-option-injected").click();
        await waitAttr(page, "wallet-address", /^0x[0-9a-fA-F]{40}$/, 60_000);
        return;
      }

      const option = testId(page, "wallet-option-privy");
      const offered = await option
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!offered) {
        if (privyFailures.length > 0) throw new SkipRun(`Privy unavailable: ${privyFailures[0]}`);
        const reason = testId(page, "wallet-fallback-reason");
        const text = (await reason.isVisible().catch(() => false)) ? (await reason.innerText()).trim() : "";
        throw new Error(text ? `Privy not offered: ${text}` : "Privy not offered");
      }

      privyFailures.length = 0;
      await option.click();
      await rec.screenshot(page, "01", "privy-modal");
      try {
        await signIn(page, email, otp);
      } catch (error) {
        if (privyFailures.length > 0) throw new SkipRun(`Privy unavailable: ${privyFailures[0]}`);
        throw error;
      }
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
      await rec.screenshot(page, "01", "signed-in");
    });

    const wallet = await step(rec, page, "02", "wallet", "the wallet on Arc", async () => {
      const address = await waitAttr(page, "wallet-address", /^0x[0-9a-fA-F]{40}$/, 30_000);
      const chain = await waitAttr(page, "wallet-chain", /^[0-9]+$/, 30_000).catch(() => "");
      if (chain !== String(ARC.chainId)) {
        await testId(page, "wallet-switch-chain").click();
        await waitAttr(page, "wallet-chain", new RegExp(`^${ARC.chainId}$`), 60_000);
      }
      const kind = project === "privy" ? "privy-embedded" : "injected";
      await expect(testId(page, "wallet-kind")).toHaveAttribute("data-state", kind, { timeout: 30_000 });
      if (injected && address.toLowerCase() !== injected.address.toLowerCase()) {
        throw new Error(`the console shows ${address}, not the injected ${injected.address}`);
      }
      rec.wallet = address;
      return address as Address;
    });

    const funded = await step(rec, page, "03", "fund", "fund 1 USDC", async () => {
      const funderKey = keys.funderKey();
      if (!funderKey) throw new Error("no funder key");
      const funder = privateKeyToAccount(funderKey);
      const before = await balanceOf(client, wallet);
      const hash = await transfer(client, funder, wallet, FUND_AMOUNT, RPC);
      rec.tx("funding", hash);
      return { before, funder };
    });

    await step(rec, page, "04", "balance", "the balance moved by 1 USDC", async () => {
      const expected = afterFunding(funded.before);
      const after = await balanceOf(client, wallet);
      if (after !== expected) throw new Error(`the wallet holds ${after}, expected ${expected}`);
      await pollValue(page, "wallet-usdc", (value) => /^[0-9]+$/.test(value) && BigInt(value) >= after, 60_000);
    });

    const bought = await step(rec, page, "05", "buy", "buy the escrow offer", async () => {
      await page.goto("/#/start");
      const startBuy = testId(page, "start-role-buy");
      const hasStart = await startBuy
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (hasStart) await startBuy.click();
      else await page.goto("/");

      const list = testId(page, "offer-list");
      await expect(list).toBeVisible({ timeout: 30_000 });
      const offer = await pickOffer(page, list);
      await offer.item.locator('[data-testid="offer-open"]').first().click();
      await expect(testId(page, "offer-hash")).toHaveAttribute(
        "data-value",
        new RegExp(`^${offer.hash}$`, "i"),
        { timeout: 30_000 },
      );

      await waitState(page, "buy-start", "ready", 30_000);
      await testId(page, "buy-start").click();
      await assertNoRefusal(page);

      await testId(page, "buy-countersign").click();
      await approveIfPrompted(page);
      await waitStateOrRefusal(page, "buy-countersigned", "signed", 120_000);
      const jobId = await waitAttr(page, "buy-countersigned", /^0x[0-9a-fA-F]{64}$/, 30_000);
      await assertNoRefusal(page);

      await testId(page, "buy-fund").click();
      await approveIfPrompted(page);
      await waitStateOrRefusal(page, "buy-funded", "funded", 120_000);
      const hash = await waitAttr(page, "buy-funded", /^0x[0-9a-fA-F]{64}$/, 30_000);
      const receipt = await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`the fund transaction ${hash} failed`);
      const event = escrowEvents(ARC, receipt).funded.find((item) => item.jobId.toLowerCase() === jobId.toLowerCase());
      if (!event) throw new Error(`the fund receipt has no Funded event for job ${jobId}`);
      if (event.buyer.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`the Funded buyer is ${event.buyer}, not ${wallet}`);
      }
      if (event.amount !== offer.price) {
        throw new Error(`the Funded amount is ${event.amount}, not the offer price ${offer.price}`);
      }
      const afterBuy = await balanceOf(client, wallet);
      const expected = afterPurchase(afterFunding(funded.before), offer.price);
      if (afterBuy !== expected) throw new Error(`the wallet holds ${afterBuy} after funding, expected ${expected}`);
      rec.tx("escrow fund", hash);
      await assertNoRefusal(page);
      return { jobId, price: offer.price };
    });

    await step(rec, page, "06", "delivery", "the seller delivers and releases", async () => {
      await waitStateOrRefusal(page, "buy-delivery", "delivered", 180_000);
      const output = testId(page, "buy-output");
      const text = (await output.innerText().catch(() => "")).trim();
      const value = (await output.getAttribute("data-value").catch(() => null)) ?? "";
      if (text === "" && value.trim() === "") throw new Error("buy-output is empty");
      const hash = await waitAttr(page, "buy-released", /^0x[0-9a-fA-F]{64}$/, 60_000);
      const receipt = await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`the release transaction ${hash} failed`);
      const released = escrowEvents(ARC, receipt).released.some(
        (event) => event.jobId.toLowerCase() === bought.jobId.toLowerCase(),
      );
      if (!released) throw new Error(`the release receipt has no Released event for job ${bought.jobId}`);
      rec.tx("release", hash);
    });

    await step(rec, page, "07", "slip", "the slip verifies", async () => {
      const slipHash = await waitAttr(page, "buy-slip-link", /^0x[0-9a-fA-F]{64}$/, 30_000);
      rec.slip = slipHash;
      await testId(page, "buy-slip-link").click();
      await expect(testId(page, "slip-hash")).toHaveAttribute(
        "data-value",
        new RegExp(`^${slipHash}$`, "i"),
        { timeout: 30_000 },
      );
      await testId(page, "slip-verify").click();
      await waitState(page, "slip-verdict", "valid", 60_000);

      const hub = hubUrl().replace(/\/$/, "");
      const response = await fetch(`${hub}/slips/${slipHash}`);
      if (response.status !== 200) throw new Error(`the hub answered ${response.status} for the slip`);
      const body = await response.text();
      const slipFile = rec.file("slip.json");
      writeFileSync(slipFile, body);
      rec.addArtifact(slipFile);

      const verifier = spawnSync("bun", ["packages/verify/src/cli.ts", slipFile, "--rpc", RPC], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 90_000,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" },
      });
      if (verifier.error) throw new Error(`the verifier did not run: ${verifier.error.message}`);
      const lines = `${verifier.stdout ?? ""}`
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const last = lines.length > 0 ? lines[lines.length - 1] : "";
      if (last !== "VALID") throw new Error(`the verifier said ${last || "nothing"} (exit ${verifier.status ?? "?"})`);
      rec.verifier = "VALID";
    });

    await softStep(rec, page, "08", "return", "return the change", async () => {
      if (project !== "injected" || !injected) return;
      const remaining = await balanceOf(client, injected.address);
      const amount = changeToReturn(remaining);
      const funderKey = keys.funderKey();
      if (amount > 0n && funderKey) {
        const funder = privateKeyToAccount(funderKey);
        await transfer(client, injected, funder.address, amount, RPC);
      }
    });

    status = "PASS";
  } catch (error) {
    if (error instanceof SkipRun) {
      status = "NOT RUN";
      skipped = error;
    } else {
      status = "FAIL";
      failed = true;
      failure = error;
    }
  } finally {
    if (tracing) {
      try {
        const trace = rec.file("trace.zip");
        await context.tracing.stop({ path: trace });
        rec.addArtifact(trace);
      } catch {
        // a trace that cannot be written must not hide the result
      }
    }
    rec.write(status, {
      ...(skipped ? { skipReason: skipped.reason } : {}),
      ...(failed ? { error: messageOf(failure) } : {}),
    });
  }

  if (skipped) test.skip(true, skipped.reason);
  raiseIfFailed(failed, failure);
};

// `bun test e2e/human/test` also matches this directory by prefix; only Playwright registers.
const underBun = (process.versions as Record<string, string | undefined>).bun !== undefined;
if (!underBun) test("the human acceptance run", runHuman);
