/**
 * 19 · The MPP rail on Tempo testnet (#5). The Machine Payments Protocol is not x402 on the
 * wire: a 402 carries a `WWW-Authenticate: Payment` challenge and the buyer answers with an
 * `Authorization: Payment` credential. The demo server runs the countersign `mpp` rail, the same
 * logic the hub will use, and the project payer pays it with the pinned mppx CLI.
 *
 * Safety, from cs-hd's handoff:
 *   - the challenge is read and checked before anything pays, because mppx 0.17.1 pays without
 *     a prompt;
 *   - the payer is always named (`--account countersign-payer`): the CLI's default account must
 *     never pay;
 *   - the stripe CLI is kept off PATH, the child sees no Stripe or mppx variables, and the target
 *     is localhost only.
 */

import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, decodeEventLog, defineChain, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { units, type Wallet } from "../lib/budget.ts";
import { TEMPO } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { freePort } from "../lib/http.ts";
import { ROOT } from "../lib/paths.ts";
import { runCmd, spawnProc } from "../lib/procs.ts";

const PAYER: Address = (process.env.E2E_MPP_PAYER ?? "0xEacEb7fD58157a39b6d4aF7A7Ca7A3AEba37486C") as Address;
const PAYER_NAME = "countersign-payer";
/** The project's MPP recipient; public, also the MPP_RECIPIENT line of the MPP env file. */
const RECIPIENT: Address = (process.env.E2E_MPP_RECIPIENT ?? "0xBfa03aCe72e48490C020Ab7CEe4beba2858f7231") as Address;
const PRICE = 10_000n; // 0.01 pathUSD
const MPPX = join(ROOT, "packages/rail/node_modules/.bin/mppx");

const tempo = createPublicClient({
  chain: defineChain({ id: TEMPO.chainId, name: "Tempo Moderato", nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 }, rpcUrls: { default: { http: [TEMPO.rpc] } } }),
  transport: http(TEMPO.rpc, { retryCount: 3, timeout: 20_000, fetchOptions: { headers: { "user-agent": "countersign-e2e" } } }),
});

function payerWallet(): Wallet {
  return {
    id: "tempo.payer.pathusd",
    label: "MPP payer",
    network: "tempo",
    asset: "pathUSD",
    address: PAYER,
    decimals: 6,
    topUp: (amount) => `WAITING cs-hd top up the MPP payer: ${amount} pathUSD to ${PAYER} on Tempo Moderato (mppx account fund --account ${PAYER_NAME} --network testnet)`,
    read: () => tempo.readContract({ address: TEMPO.pathUsd, abi: erc20Abi, functionName: "balanceOf", args: [PAYER] }),
  };
}

interface Challenge {
  header: string;
  method: string;
  request: { amount?: string; currency?: string; recipient?: string; methodDetails?: { chainId?: number }; externalId?: string };
}

function parseChallenge(header: string): Challenge {
  const param = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(header)?.[1];
  const method = param("method") ?? "";
  const raw = param("request");
  check(raw, `the challenge carries a request parameter (${header.slice(0, 80)}…)`);
  return { header, method, request: JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Challenge["request"] };
}

/** The checks that must hold before anything is allowed to pay. */
function checkChallenge(c: Challenge): void {
  equal(c.method, "tempo", "challenge method");
  equal(c.request.amount, PRICE.toString(), "challenge amount");
  sameHex(c.request.currency ?? "", TEMPO.pathUsd, "challenge currency is pathUSD");
  equal(getAddress(c.request.recipient ?? "0x0000000000000000000000000000000000000000"), getAddress(RECIPIENT), "challenge recipient");
  equal(c.request.methodDetails?.chainId, TEMPO.chainId, "challenge chain is Tempo Moderato");
  check(/^0x[0-9a-fA-F]{64}$/.test(c.request.externalId ?? ""), "the challenge names the offer hash as externalId");
}

/** A directory holding only the interpreters mppx needs, so the stripe CLI is never on PATH. */
function safePath(ctx: FlowCtx): string {
  const dir = join(ctx.dir, "bin");
  mkdirSync(dir, { recursive: true });
  for (const name of ["node", "npm", "npx", "bun"]) {
    const target = Bun.which(name);
    if (target) {
      try {
        symlinkSync(target, join(dir, name));
      } catch {
        // already linked
      }
    }
  }
  return `${dir}:/usr/bin:/bin`;
}

function mppx(ctx: FlowCtx, label: string, args: string[]) {
  return runCmd(
    {
      name: `mppx ${label}`,
      cmd: [MPPX, ...args, "--account", PAYER_NAME, "--network", "testnet", "--rpc-url", TEMPO.rpc],
      // Only PATH and HOME (mppx's account store) reach the child: no Stripe or mppx variables.
      env: { PATH: safePath(ctx) },
      log: join(ctx.dir, `mppx-${label}.log`),
      // A signed credential is a bearer payment until it is spent: it never reaches a log.
      redact: (s) => ctx.env.secrets.redact(s).replace(/(Payment\s+)[A-Za-z0-9._~+/=:,"-]{24,}/g, "$1[credential]"),
    },
    180_000,
  );
}

/**
 * mppx sign, read in memory: its output is the credential itself, so it is never written to a
 * log. Only its exit code and a masked line go to the flow's artifacts.
 */
async function signCredential(ctx: FlowCtx, challenge: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([MPPX, "sign", "--challenge", challenge, "--format", "json", "--account", PAYER_NAME, "--network", "testnet", "--rpc-url", TEMPO.rpc], {
    cwd: ROOT,
    env: { PATH: safePath(ctx), HOME: process.env.HOME ?? "/tmp", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  ctx.save("mppx-sign.log", `exit ${code}\n${ctx.env.secrets.redact(stderr)}\n(stdout held in memory: it is the signed credential)\n`);
  return { code, stdout, stderr: ctx.env.secrets.redact(stderr) };
}

async function transferChecked(tx: Hex): Promise<void> {
  const rcpt = await tempo.waitForTransactionReceipt({ hash: tx, timeout: 90_000, pollingInterval: 1500 });
  equal(rcpt.status, "success", "Tempo receipt status");
  const moves = rcpt.logs
    .filter((l) => getAddress(l.address) === getAddress(TEMPO.pathUsd))
    .map((l) => {
      try {
        const ev = decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics });
        return ev.eventName === "Transfer" ? (ev.args as { from: Address; to: Address; value: bigint }) : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is { from: Address; to: Address; value: bigint } => x !== null);
  const toRecipient = moves.filter((m) => getAddress(m.to) === getAddress(RECIPIENT));
  equal(toRecipient.length, 1, "pathUSD transfers to the recipient");
  equal(getAddress(toRecipient[0]!.from), getAddress(PAYER), "the transfer comes from the named payer");
  equal(toRecipient[0]!.value, PRICE, "exactly the price reaches the recipient");
}

export const mpp: Flow = {
  name: "mpp",
  title: "MPP rail pays for real on Tempo testnet",
  owner: "cs-hd",
  network: "tempo",
  spends: () => [{ wallet: payerWallet(), amount: 3n * PRICE, floor: units("1", 6) }],
  async run(ctx) {
    const port = freePort();
    const base = `http://localhost:${port}`;
    const paidUrl = `${base}/rail/paid`;

    await ctx.step("demo server up on the mpp rail", async () => {
      const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
      ctx.env.secrets.hide(secret);
      const proc = spawnProc({
        name: "mpp server",
        cmd: ["bun", "scripts/mpp/server.ts", String(port)],
        env: { MPP_SECRET_KEY: secret, MPP_RECIPIENT: RECIPIENT },
        log: join(ctx.dir, "mpp-server.log"),
        redact: (s) => ctx.env.secrets.redact(s),
      });
      ctx.defer(() => proc.stop());
      const ready = await proc.waitFor(/mpp demo on http:\/\/localhost:\d+: (.*)$/m, 30_000);
      check(ready[1]?.includes("chain 42431") && ready[1].includes("Stripe card method off"), `ready line: ${ready[1]}`);
    });

    await ctx.step("the 402 names Tempo testnet, the price and the recipient, before anything pays", async () => {
      const res = await ctx.http("unpaid call", paidUrl);
      equal(res.status, 402, "unpaid status");
      const header = res.headers.get("www-authenticate");
      check(header && /^Payment\s/i.test(header), "402 carries a WWW-Authenticate Payment challenge");
      const c = parseChallenge(header);
      ctx.save("challenge.json", c.request);
      checkChallenge(c);
    });

    const paid = await ctx.step("the named payer pays with the pinned mppx", async () => {
      const r = await mppx(ctx, "pay", [paidUrl, "-i"]);
      equal(r.code, 0, `mppx exit code (stderr ${JSON.stringify(r.stderr.trim().slice(-300))})`);
      const receiptB64 = /^payment-receipt:\s*(\S+)/im.exec(r.stdout)?.[1];
      check(receiptB64, "the paid answer carries a Payment-Receipt header");
      const receipt = JSON.parse(Buffer.from(receiptB64, "base64url").toString("utf8")) as { method?: string; status?: string; reference?: string };
      const bodyLine = r.stdout.split("\n").reverse().find((l) => l.trim().startsWith("{"));
      check(bodyLine, "the paid answer has a JSON body");
      const body = JSON.parse(bodyLine) as { ok?: boolean; transaction?: string };
      equal(body.ok, true, "paid body ok");
      check(/^0x[0-9a-fA-F]{64}$/.test(body.transaction ?? ""), "the body names the Tempo transaction");
      equal(receipt.method, "tempo", "receipt method");
      equal(receipt.status, "success", "receipt status");
      sameHex(receipt.reference ?? "", body.transaction as string, "receipt reference is the transaction");
      ctx.tx("tempo", "mpp payment", body.transaction as string);
      return body.transaction as Hex;
    });

    await ctx.step("Moderato shows exactly the price moved from the payer to the recipient", () => transferChecked(paid));

    await ctx.step("a credential replayed is refused", async () => {
      const res = await ctx.http("fresh challenge", paidUrl);
      equal(res.status, 402, "fresh challenge status");
      const header = res.headers.get("www-authenticate") as string;
      checkChallenge(parseChallenge(header));
      const signed = await signCredential(ctx, header);
      equal(signed.code, 0, `mppx sign exit code (stderr ${JSON.stringify(signed.stderr.trim().slice(-300))})`);
      const out = signed.stdout.trim();
      let authorization = "";
      try {
        const parsed = JSON.parse(out) as unknown;
        authorization = typeof parsed === "string" ? parsed : String((parsed as Record<string, unknown>).authorization ?? (parsed as Record<string, unknown>).header ?? "");
      } catch {
        authorization = out.split("\n").find((l) => /^Payment\s/i.test(l.replace(/^authorization:\s*/i, ""))) ?? "";
      }
      authorization = authorization.replace(/^authorization:\s*/i, "").trim();
      check(/^Payment\s/i.test(authorization), "mppx sign printed a Payment credential");
      ctx.env.secrets.hide(authorization);
      const first = await ctx.http("signed credential", paidUrl, { headers: { authorization } });
      equal(first.status, 200, `first use status (${first.text.slice(0, 160)})`);
      const tx = (first.json as { transaction?: string }).transaction;
      check(tx, "the first use names its transaction");
      ctx.tx("tempo", "mpp payment (signed credential)", tx);
      const second = await ctx.http("replayed credential", paidUrl, { headers: { authorization } });
      equal(second.status, 409, "replay status");
      equal((second.json as { reason?: string }).reason, "replay", "replay reason");
    });
  },
};
