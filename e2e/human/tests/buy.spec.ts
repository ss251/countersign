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
import { parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC, escrowEvents } from "../../lib/chains.ts";
import { sessionEnvelopeProblems, type SessionEnvelope } from "../lib/envelope.ts";
import { raiseIfFailed } from "../lib/failure.ts";
import {
  approveIfPrompted,
  dialogVisible,
  openPrivy,
  privySignatureNote,
  recordPrivyConsole,
  recordPrivyRequestFailure,
  recordPrivyResponse,
  signIn,
  waitForModalClosed,
} from "../lib/privy.ts";
import {
  afterFunding,
  arcClient,
  balanceOf,
  changeToReturn,
  FUND_AMOUNT,
  transfer,
} from "../lib/fund.ts";
import { Keyring } from "../lib/keys.ts";
import { compareSettlement, REVIEW_FIELD, reviewValuesOf } from "../lib/review.ts";
import { escrowRailAddress, slipHashFromHref } from "../lib/slip.ts";
import { installTestWallet, newTestAccount } from "../lib/wallet.ts";
import {
  currentRunId,
  hubUrl,
  Recorder,
  REPO_ROOT,
  type ProjectStatus,
} from "../lib/report.ts";

const RPC = process.env.E2E_ARC_RPC || ARC.rpc;

const FUNDED = parseAbiItem(
  "event Funded(bytes32 indexed jobId, bytes32 indexed offerHash, address indexed buyer, address payee, uint256 amount, uint64 deadline)",
);
const RELEASED = parseAbiItem(
  "event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)",
);

class SkipRun extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SkipRun";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** STEER-0300 C1: a wait between the review and Sign, from 0 to 600 whole seconds. */
function signDelaySeconds(): number {
  const signDelayS = Number(process.env.E2E_HUMAN_SIGN_DELAY_S ?? "0");
  if (!Number.isInteger(signDelayS) || signDelayS < 0 || signDelayS > 600) {
    throw new Error("E2E_HUMAN_SIGN_DELAY_S must be 0..600");
  }
  return signDelayS;
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

function missingAttribute(testid: string, name: string): Error {
  return new Error(`the console does not expose ${testid}[${name}] (cs-ui)`);
}

/** The hub's answer as status and code only; never a request header. */
async function hubFailure(response: Response): Promise<string> {
  let code = "no code";
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === "string" && body.code !== "") code = body.code;
  } catch {
    // a body that is not JSON has no code
  }
  return `${response.status} (${code})`;
}

async function waitAttr(
  page: Page,
  testid: string,
  pattern: RegExp,
  timeoutMs: number,
  name = "data-value",
): Promise<string> {
  const locator = testId(page, testid);
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    const value = await locator.getAttribute(name, { timeout: 1_000 }).catch(() => null);
    if (value !== null) {
      last = value;
      if (pattern.test(value)) return value;
    }
    await page.waitForTimeout(250);
  }
  if (last === null) throw missingAttribute(testid, name);
  throw new Error(`${testid}[${name}] is ${JSON.stringify(last)}, not ${pattern}`);
}

async function refusalText(page: Page): Promise<string | undefined> {
  const locator = testId(page, "start-refusal");
  if (!(await locator.isVisible().catch(() => false))) return undefined;
  const text = (await locator.innerText().catch(() => "")).trim();
  return text || "the console refused the purchase";
}

async function assertNoRefusal(page: Page): Promise<void> {
  const text = await refusalText(page);
  if (text) throw new Error(text);
}

async function waitResult(page: Page, timeoutMs: number): Promise<Hex> {
  const locator = testId(page, "start-fund-result");
  const deadline = Date.now() + timeoutMs;
  let saw = false;
  let last = "";
  while (Date.now() < deadline) {
    const refusal = await refusalText(page);
    if (refusal) throw new Error(refusal);
    const value = await locator.getAttribute("data-value", { timeout: 1_000 }).catch(() => null);
    if (value !== null) {
      saw = true;
      last = value;
      if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value as Hex;
    }
    await page.waitForTimeout(500);
  }
  if (!saw) throw missingAttribute("start-fund-result", "data-value");
  throw new Error(`start-fund-result[data-value] is ${JSON.stringify(last)}, not a transaction hash`);
}

function watchPrivy(page: Page, failures: string[]): void {
  page.on("response", (response) => {
    recordPrivyResponse(failures, response.url(), response.status());
  });
  page.on("requestfailed", (request) => {
    recordPrivyRequestFailure(failures, request.url(), request.failure()?.errorText);
  });
}

async function approveAndNote(rec: Recorder, page: Page): Promise<void> {
  const clicks = await approveIfPrompted(page);
  if (clicks > 1) rec.note(privySignatureNote(clicks));
}

interface SlipFields {
  jobId: Hex;
  offerHash: Hex;
  amount: bigint;
  buyer: Address;
  escrow: Address;
}

/** The hub wraps a slip in `{ body, hash, ... }`; a bare body is accepted too. */
function slipFieldsOf(value: unknown): SlipFields {
  if (typeof value !== "object" || value === null) throw new Error("the hub's slip is not an object");
  const record = value as Record<string, unknown>;
  const body =
    typeof record.body === "object" && record.body !== null
      ? (record.body as Record<string, unknown>)
      : record;
  const jobId = body.jobId;
  const offerHash = body.offerHash;
  const amount = body.amount;
  const buyer = body.buyer;
  const escrow = body.escrow;
  if (typeof jobId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(jobId)) {
    throw new Error("the slip has no 0x job id");
  }
  if (typeof offerHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(offerHash)) {
    throw new Error("the slip has no 0x offer hash");
  }
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
    throw new Error("the slip has no atomic amount");
  }
  if (typeof buyer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) {
    throw new Error("the slip has no buyer address");
  }
  if (typeof escrow !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(escrow)) {
    throw new Error("the slip names no escrow");
  }
  return {
    jobId: jobId as Hex,
    offerHash: offerHash as Hex,
    amount: BigInt(amount),
    buyer: buyer as Address,
    escrow: escrow as Address,
  };
}

interface ListedOffer {
  price: bigint;
  payee: Address;
}

/** The hub wraps an offer in `{ offer, ... }`; a bare offer is accepted too. */
function listedOfferOf(value: unknown): ListedOffer {
  if (typeof value !== "object" || value === null) throw new Error("the hub's offer is not an object");
  const record = value as Record<string, unknown>;
  const offer =
    typeof record.offer === "object" && record.offer !== null
      ? (record.offer as Record<string, unknown>)
      : record;
  const price = offer.price;
  const seller = offer.seller;
  if (typeof price !== "string" || !/^[0-9]+$/.test(price)) {
    throw new Error("the offer has no atomic price");
  }
  if (typeof seller !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(seller)) {
    throw new Error("the offer has no seller address");
  }
  const payTo = offer.payTo;
  const escrow =
    typeof payTo === "object" && payTo !== null ? (payTo as Record<string, unknown>).escrow : undefined;
  const payee = escrow === null || escrow === undefined ? seller : escrow;
  if (typeof payee !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payee)) {
    throw new Error("the offer's escrow payee is not an address");
  }
  return { price: BigInt(price), payee: payee as Address };
}

const runHuman = async (
  { page, context }: PlaywrightTestArgs & PlaywrightWorkerArgs,
  testInfo: TestInfo,
): Promise<void> => {
  const project = testInfo.project.name;
  if (project !== "privy" && project !== "injected") test.skip(true, `unknown project ${project}`);

  const signDelayS = signDelaySeconds();
  const runId = currentRunId();
  const rec = new Recorder(runId, project);
  const keys = new Keyring();
  const client = arcClient(RPC);
  const email = keys.secret("PRIVY_TEST_EMAIL") ?? "";
  const otp = keys.secret("PRIVY_TEST_OTP") ?? "";
  rec.guardWith(keys);
  const injected = project === "injected" ? newTestAccount() : undefined;
  const privyFailures: string[] = [];
  let tracing = false;
  let status: ProjectStatus = "FAIL";
  let skipped: SkipRun | undefined;
  let failed = false;
  let failure: unknown;

  if (project === "privy") {
    const consoleFile = rec.file("console.log");
    recordPrivyConsole(page, consoleFile);
    rec.addArtifact(consoleFile);
    watchPrivy(page, privyFailures);
  }

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
      await expect(testId(page, "wallet-menu")).toBeVisible({ timeout: 30_000 });
    });

    await step(rec, page, "01", "sign-in", "sign in", async () => {
      // Privy's login() does nothing before the SDK is ready; give the page a person's pause.
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await testId(page, "wallet-menu").click();
      if (injected) {
        await testId(page, "wallet-connect-injected").click();
        if (await dialogVisible(page, 15_000)) {
          const testWallet = page
            .getByRole("dialog")
            .getByRole("button", { name: /countersign test wallet/i });
          const offered = await testWallet
            .waitFor({ state: "visible", timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
          if (!offered) throw new Error("Privy's wallet list did not offer the Countersign test wallet");
          await testWallet.click();
        }
        await waitAttr(page, "wallet-address", /^0x[0-9a-fA-F]{40}$/, 60_000);
        return;
      }

      const option = testId(page, "wallet-signin");
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
      await openPrivy({
        clickSignIn: () => option.click(),
        clickMenu: () => testId(page, "wallet-menu").click(),
        dialogVisible: () => dialogVisible(page, 10_000),
        menuUsable: () =>
          page
            .locator("#privy-dialog-backdrop")
            .waitFor({ state: "hidden", timeout: 2_000 })
            .then(() => true)
            .catch(() => false),
        note: (text) => rec.note(text),
      });
      try {
        await signIn(page, email, otp, () =>
          rec.screenshot(page, "01", "privy-modal", { showPrivy: true }),
        );
      } catch (error) {
        if (privyFailures.length > 0) throw new SkipRun(`Privy unavailable: ${privyFailures[0]}`);
        throw error;
      }
      await waitForModalClosed(page, 30_000);
      await rec.screenshot(page, "01", "signed-in");
    });

    const wallet = await step(rec, page, "02", "wallet", "the wallet on Arc", async () => {
      const address = await waitAttr(page, "wallet-address", /^0x[0-9a-fA-F]{40}$/, 30_000);
      const kind = await waitAttr(page, "wallet-address", /^(privy|injected)$/, 30_000, "data-kind");
      const expectedKind = project === "privy" ? "privy" : "injected";
      if (kind !== expectedKind) {
        throw new Error(`wallet-address[data-kind] is ${kind}, not ${expectedKind}`);
      }
      let chain = await waitAttr(page, "wallet-chain", /^[0-9]+$/, 30_000);
      if (chain !== String(ARC.chainId)) {
        await page.getByRole("button", { name: /switch to arc/i }).click();
        chain = await waitAttr(page, "wallet-chain", new RegExp(`^${ARC.chainId}$`), 60_000);
      }
      if (chain !== String(ARC.chainId)) {
        throw new Error(`wallet-chain[data-value] is ${chain}, not ${ARC.chainId}`);
      }
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
      const receipt = await client.getTransactionReceipt({ hash });
      return { before, blockNumber: receipt.blockNumber };
    });

    const fundedBalance = await step(rec, page, "04", "balance", "the balance moved by 1 USDC", async () => {
      const expected = afterFunding(funded.before);
      const after = await balanceOf(client, wallet);
      if (after !== expected) throw new Error(`the wallet holds ${after}, expected ${expected}`);
      return after;
    });

    const bought = await step(rec, page, "05", "buy", "buy the offer", async () => {
      await page.goto("/#/start");
      await expect(testId(page, "start-buy")).toBeVisible({ timeout: 30_000 });

      const offer = testId(page, "start-offer");
      await expect(offer).toBeVisible({ timeout: 30_000 });
      rec.note(`offer: ${(await offer.innerText()).trim()}`);

      const countersign = testId(page, "start-countersign");
      await expect(countersign).toBeEnabled({ timeout: 60_000 });
      await countersign.click();

      await expect(testId(page, "start-review")).toBeVisible({ timeout: 30_000 });
      const review = reviewValuesOf({
        "start-payee": await waitAttr(page, "start-payee", REVIEW_FIELD["start-payee"], 30_000),
        "start-amount": await waitAttr(page, "start-amount", REVIEW_FIELD["start-amount"], 30_000),
        "start-job": await waitAttr(page, "start-job", REVIEW_FIELD["start-job"], 30_000),
      });
      rec.note(`review payee: ${review.payee}`);
      rec.note(`review amount: ${review.amount}`);
      rec.note(`review job: ${review.job}`);
      await rec.screenshot(page, "05", "review");

      if (signDelayS > 0) {
        rec.note(`waited ${signDelayS} s between the review and Sign (STEER-0300 C1 stale case)`);
        test.setTimeout(testInfo.timeout + signDelayS * 1000);
        await page.waitForTimeout(signDelayS * 1000);
      }

      await testId(page, "start-sign").click();
      await approveAndNote(rec, page);
      await approveAndNote(rec, page);

      const hash = await waitResult(page, 120_000);
      await assertNoRefusal(page);

      await expect(testId(page, "start-slip")).toBeVisible({ timeout: 30_000 });
      const href = await testId(page, "start-verify").getAttribute("href");
      if (href === null) throw missingAttribute("start-verify", "href");
      const slipHash = slipHashFromHref(href);
      if (!slipHash) {
        throw new Error(`start-verify[href] is ${JSON.stringify(href)}, not #/verify/<hash>`);
      }
      rec.slip = slipHash;
      return { hash, slipHash, review };
    });

    const proof = await step(rec, page, "06", "prove", "prove the purchase on chain", async () => {
      const hub = hubUrl().replace(/\/$/, "");
      const response = await fetch(`${hub}/slips/${bought.slipHash}`);
      if (response.status !== 200) throw new Error(`the hub answered ${response.status} for the slip`);
      const text = await response.text();
      const slipFile = rec.file("slip.json");
      writeFileSync(slipFile, text);
      rec.addArtifact(slipFile);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("the hub's slip is not JSON");
      }
      const slip = slipFieldsOf(parsed);
      if (slip.buyer.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`the slip buyer is ${slip.buyer}, not ${wallet}`);
      }

      const railsResponse = await fetch(`${hub}/rails`);
      if (railsResponse.status !== 200) {
        throw new Error(`the hub answered ${railsResponse.status} for the rails`);
      }
      let railsValue: unknown;
      try {
        railsValue = await railsResponse.json();
      } catch {
        throw new Error("the hub's rails are not JSON");
      }
      const declared = escrowRailAddress(railsValue);
      if (declared === null || slip.escrow.toLowerCase() !== declared.toLowerCase()) {
        throw new Error(`the slip's escrow ${slip.escrow} is not the escrow production declares (${declared})`);
      }
      rec.note(`escrow: ${slip.escrow}`);

      const offerResponse = await fetch(`${hub}/offers/${slip.offerHash}`);
      if (offerResponse.status !== 200) {
        throw new Error(`the hub answered ${offerResponse.status} for the offer`);
      }
      const offerText = await offerResponse.text();
      const offerFile = rec.file("offer.json");
      writeFileSync(offerFile, offerText);
      rec.addArtifact(offerFile);

      let listedValue: unknown;
      try {
        listedValue = JSON.parse(offerText);
      } catch {
        throw new Error("the hub's offer is not JSON");
      }
      const listed = listedOfferOf(listedValue);
      if (slip.amount !== listed.price) {
        throw new Error(`the slip amount is ${slip.amount}, but the offer lists ${listed.price}`);
      }

      const fundedLogs = await client.getLogs({
        address: slip.escrow,
        event: FUNDED,
        args: { jobId: slip.jobId },
        fromBlock: funded.blockNumber,
        toBlock: "latest",
      });
      if (fundedLogs.length !== 1) {
        throw new Error(`expected one Funded log for job ${slip.jobId}, found ${fundedLogs.length}`);
      }
      const fundLog = fundedLogs[0];
      if (!fundLog?.transactionHash) throw new Error(`the Funded log for job ${slip.jobId} has no transaction hash`);
      const fundArgs = fundLog.args;
      if (!fundArgs) throw new Error(`the Funded log for job ${slip.jobId} has no arguments`);
      const fundBuyer = fundArgs.buyer;
      const fundPayee = fundArgs.payee;
      const fundAmount = fundArgs.amount;
      const fundOfferHash = fundArgs.offerHash;
      if (
        fundBuyer === undefined ||
        fundPayee === undefined ||
        fundAmount === undefined ||
        fundOfferHash === undefined
      ) {
        throw new Error(`the Funded log for job ${slip.jobId} has incomplete arguments`);
      }
      if (fundBuyer.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error(`the Funded buyer is ${fundBuyer}, not ${wallet}`);
      }
      const comparison = compareSettlement(
        bought.review,
        { payee: fundPayee, amount: slip.amount, job: slip.jobId },
        signDelayS,
      );
      if (comparison.note) rec.note(comparison.note);
      if (fundAmount !== slip.amount) {
        throw new Error(`the Funded amount is ${fundAmount}, not the slip amount ${slip.amount}`);
      }
      if (fundAmount !== listed.price || fundPayee.toLowerCase() !== listed.payee.toLowerCase()) {
        throw new Error(
          `the buyer paid ${fundAmount} to ${fundPayee}, but the offer lists ${listed.price} to ${listed.payee}`,
        );
      }
      if (fundOfferHash.toLowerCase() !== slip.offerHash.toLowerCase()) {
        throw new Error(`the Funded offer hash is ${fundOfferHash}, not the slip's ${slip.offerHash}`);
      }
      rec.tx("escrow fund", fundLog.transactionHash);

      let releasedLogs = await client.getLogs({
        address: slip.escrow,
        event: RELEASED,
        args: { jobId: slip.jobId },
        fromBlock: funded.blockNumber,
        toBlock: "latest",
      });
      const releaseDeadline = Date.now() + 180_000;
      while (releasedLogs.length === 0 && Date.now() < releaseDeadline) {
        await page.waitForTimeout(2_000);
        releasedLogs = await client.getLogs({
          address: slip.escrow,
          event: RELEASED,
          args: { jobId: slip.jobId },
          fromBlock: funded.blockNumber,
          toBlock: "latest",
        });
      }
      if (releasedLogs.length !== 1) {
        throw new Error(`expected one Released log for job ${slip.jobId}, found ${releasedLogs.length}`);
      }
      const releaseLog = releasedLogs[0];
      if (!releaseLog?.transactionHash) throw new Error(`the Released log for job ${slip.jobId} has no transaction hash`);
      const releaseArgs = releaseLog.args;
      if (!releaseArgs) throw new Error(`the Released log for job ${slip.jobId} has no arguments`);
      const releasedSlip = releaseArgs.slipHash;
      if (releasedSlip === undefined) {
        throw new Error(`the Released log for job ${slip.jobId} has no slip hash`);
      }
      if (releasedSlip.toLowerCase() !== bought.slipHash.toLowerCase()) {
        throw new Error(`the Released slip hash is ${releasedSlip}, not ${bought.slipHash}`);
      }
      rec.tx("release", releaseLog.transactionHash);

      const resultReceipt = await client.waitForTransactionReceipt({ hash: bought.hash, timeout: 120_000 });
      if (resultReceipt.status !== "success") {
        throw new Error(`the result transaction ${bought.hash} failed`);
      }
      const events = escrowEvents({ ...ARC, escrow: slip.escrow }, resultReceipt);
      const recorded =
        events.funded.some((event) => event.jobId.toLowerCase() === slip.jobId.toLowerCase()) ||
        events.released.some((event) => event.jobId.toLowerCase() === slip.jobId.toLowerCase());
      if (!recorded) {
        throw new Error(`the result transaction ${bought.hash} has no escrow event for job ${slip.jobId}`);
      }

      const after = await balanceOf(client, wallet);
      const expected = fundedBalance - slip.amount;
      if (after !== expected) {
        throw new Error(`the wallet holds ${after} after the purchase, expected ${expected}`);
      }
      return { slipFile };
    });

    await step(rec, page, "07", "slip", "the slip verifies", async () => {
      await testId(page, "start-verify").click();
      await expect(page).toHaveURL(new RegExp(`#/verify/${bought.slipHash}$`, "i"), { timeout: 30_000 });
      await waitAttr(page, "verify-verdict", /^valid$/, 60_000, "data-state");

      const verifier = spawnSync("bun", ["packages/verify/src/cli.ts", proof.slipFile, "--rpc", RPC], {
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

    if (project === "privy") {
      await step(rec, page, "09", "buyer", "Buyer offers to create an envelope", async () => {
        await page.goto("/#/buyer");
        const locked = testId(page, "buyer-locked");
        await expect(locked).toBeVisible({ timeout: 30_000 });
        const create = locked.getByRole("button", { name: /create an envelope/i });
        await expect(create).toBeVisible({ timeout: 30_000 });
        await expect(create).toBeEnabled({ timeout: 30_000 });
      });

      const session = await step(rec, page, "10", "envelope", "Create an envelope, shown in place", async () => {
        const before = page.url();
        await testId(page, "buyer-locked")
          .getByRole("button", { name: /create an envelope/i })
          .click();

        await expect(testId(page, "buyer-locked")).toBeHidden({ timeout: 30_000 });
        await expect(page.locator('[role="alert"]:visible')).toHaveCount(0);
        await expect(
          page
            .getByText("Nothing is waiting for you.", { exact: true })
            .or(page.locator('article[aria-labelledby="approval-title"]'))
            .first(),
        ).toBeVisible({ timeout: 30_000 });
        if (!new URL(page.url()).hash.startsWith("#/buyer")) {
          throw new Error(`the page left the buyer route: ${before} -> ${page.url()}`);
        }

        const token = await page.evaluate(() => window.localStorage.getItem("countersign.approval-token"));
        if (token === null || !/^cse_[0-9a-f]{64}$/.test(token)) {
          throw new Error("the console stored no session token");
        }
        keys.hide(token);

        const storedAgent = await page.evaluate(() => window.localStorage.getItem("countersign.agent"));
        if (storedAgent === null || storedAgent.toLowerCase() !== wallet.toLowerCase()) {
          throw new Error("the console stored another agent, not the embedded wallet");
        }

        const hub = hubUrl().replace(/\/$/, "");
        const response = await fetch(`${hub}/envelopes/${wallet}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.status !== 200) {
          throw new Error(`the hub answered ${await hubFailure(response)} for the envelope`);
        }
        const answer = (await response.json()) as { envelope?: SessionEnvelope };
        if (typeof answer.envelope !== "object" || answer.envelope === null) {
          throw new Error("the hub's envelope answer has no envelope");
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const problems = sessionEnvelopeProblems(answer.envelope, wallet, nowSeconds);
        if (problems.length > 0) throw new Error(problems.join("; "));

        const scope = await fetch(
          `${hub}/envelopes/0x000000000000000000000000000000000000dEaD`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (scope.status !== 401) {
          throw new Error(
            `a session token reads only its own agent's envelope: the hub answered ${await hubFailure(scope)}`,
          );
        }

        const expiresAt = answer.envelope.expiresAt;
        if (typeof expiresAt !== "number") throw new Error("the envelope has no expiresAt");
        return { expiresAt };
      });

      await step(rec, page, "11", "envelope-tab", "The envelope tab shows the envelope", async () => {
        await page
          .getByRole("navigation", { name: "Buyer" })
          .getByRole("link", { name: /envelope/i })
          .click();
        await expect(page.getByRole("region", { name: "Budget" })).toBeVisible({ timeout: 30_000 });
        if (!new URL(page.url()).hash.startsWith("#/buyer")) {
          throw new Error("the page left the buyer route on the envelope tab");
        }
        const hours = Math.round((session.expiresAt - Math.floor(Date.now() / 1000)) / 3600);
        rec.note(`envelope: cap 1 USDC, per seller 0.5, ask above 0.05, expires in ${hours} h`);
      });
    }

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
