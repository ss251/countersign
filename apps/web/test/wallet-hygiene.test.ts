import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { authorizationTypedData, jobIdOf, offerHash as hashOf, type Offer, type PaymentRequirements } from "@countersign/core";
import { ARC_PIN } from "../src/lib/arc-pin.ts";
import { buildAuthorization, pendingOf, trustedRequirement } from "../src/lib/purchase.ts";
import type { Listing } from "../src/lib/types.ts";
import { nextWords, SignReview } from "../src/ui/SignReview.tsx";
import { scanDist, scanFile } from "../scripts/wallet-grep.ts";

/*
 * STEER-2225: MetaMask's Blockaid scan flagged the console as a possible drainer. One test per point of
 * the captain's hygiene list, over our own sources, the built bundle and the one place a wallet signs.
 */

const SRC = new URL("../src/", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = walk(SRC).map((path) => ({ file: path.slice(SRC.length), text: readFileSync(path, "utf8") }));

/** The bodies of every useEffect in a file, by brace matching from each `useEffect(`. */
function effectBodies(text: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf("useEffect(", from);
    if (at < 0) return bodies;
    let depth = 0;
    let end = at + "useEffect(".length;
    for (let i = end; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      if (ch === ")" || ch === "}" || ch === "]") {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      }
    }
    bodies.push(text.slice(at, end));
    from = end;
  }
}

const seller = "0x196768E381490a9849d44bd8427784e9fD3aCd07";
const buyer = "0x8c1f9e2b7d6a5f4e3c2b1a09f8e7d6c5b4a3a20b" as const;
const offer = {
  v: 1,
  seller,
  title: "use-arc",
  summary: "Answers one question about Arc.",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "10000",
  bond: "0",
  deadline: 60,
  rails: ["escrow"],
  issuedAt: 1_793_950_000,
} as unknown as Offer;
const listing: Listing = { hash: hashOf(offer), offer, seller: { name: "use-arc" }, status: "listed", online: true };
const req: PaymentRequirements = {
  scheme: "countersign",
  network: "eip155:5042002",
  amount: "10000",
  asset: ARC_PIN.token,
  payTo: seller,
  maxTimeoutSeconds: 60,
  extra: {
    rail: "escrow",
    escrow: ARC_PIN.escrow,
    chainId: ARC_PIN.chainId,
    offerHash: listing.hash,
    deadlineSeconds: 60,
    tokenName: ARC_PIN.tokenName,
    tokenVersion: ARC_PIN.tokenVersion,
  },
};

describe("STEER-2225 wallet hygiene", () => {
  test("1. nothing touches a wallet on load: both wagmi providers set reconnectOnMount={false}", () => {
    const providers = sources.find((s) => s.file === "app/Providers.tsx")!.text;
    const tags = [...providers.matchAll(/<(Wagmi|PrivyWagmi)Provider\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThanOrEqual(2);
    for (const tag of tags) expect(tag).toContain("reconnectOnMount={false}");
  });

  test("1. no code asks for accounts, connects, signs in or switches chain from an effect: only clicks do", () => {
    for (const { file, text } of sources) {
      expect({ file, hit: /eth_requestAccounts/.test(text) }).toEqual({ file, hit: false });
      for (const body of effectBodies(text)) {
        const touches = /\b(connect|connectWallet|login|switchChain|switchChainAsync|signTypedData|signTypedDataAsync)\s*\(/.test(body);
        expect({ file, touches }).toEqual({ file, touches: false });
      }
    }
  });

  test("1. a chain switch says why, right beside its button", () => {
    const start = sources.find((s) => s.file === "routes/start/index.tsx")!.text;
    expect(start).toContain("This purchase settles on Arc testnet, so switch there first.");
    const card = sources.find((s) => s.file === "routes/assistant/cardMode.ts")!.text;
    expect(card).toContain("Switch to Arc testnet to countersign this with your wallet.");
  });

  test("2. our code never calls eth_sign, personal_sign, a wallet's signMessage, approve, permit or setApprovalForAll", () => {
    const banned = [
      /["'`]eth_sign["'`]/,
      /personal_sign/,
      /useSignMessage/,
      /functionName\s*:\s*["'`](approve|increaseAllowance|permit|setApprovalForAll)["'`]/,
      /setApprovalForAll/,
      /\berc20Abi\b|\berc721Abi\b/,
    ];
    for (const { file, text } of sources) {
      for (const pattern of banned) expect({ file, pattern: String(pattern), hit: pattern.test(text) }).toEqual({ file, pattern: String(pattern), hit: false });
    }
    // The one signMessage is the phone's own approver key (a viem account this page made), never a wallet,
    // and it signs approval decisions and revokes, which move no money.
    const signers = sources.filter((s) => /\bsignMessage\s*\(/.test(s.text)).map((s) => s.file);
    expect(signers).toEqual(["lib/approver.ts"]);
    expect(sources.find((s) => s.file === "lib/approver.ts")!.text).toMatch(/privateKeyToAccount\(key\)\.signMessage\(/);
  });

  test("2. the bundle scan flags our own approve or eth_sign, and every selector, but not a library naming them", () => {
    const map = (source: string) => ({ sources: [source], mappings: "AAAA" });
    expect(scanFile('x({functionName:"approve"})', map("../../src/lib/x.ts")).map((h) => h.name)).toHaveLength(1);
    expect(scanFile("case`eth_sign`:", map("../../src/lib/x.ts")).map((h) => h.name)).toEqual(["the eth_sign method"]);
    expect(scanFile('x({functionName:"approve"})', map("../../../node_modules/@privy-io/react-auth/dist/x.mjs"))).toEqual([]);
    expect(scanFile("const s='0x095ea7b3'", map("../../../node_modules/lib/x.mjs")).map((h) => h.name)).toEqual([
      "approve(address,uint256) selector 0x095ea7b3",
    ]);
  });

  const dist = new URL("../dist", import.meta.url).pathname;
  test.skipIf(!existsSync(join(dist, "assets")))("2. the built bundle carries no approval or permit selector, and our code no eth_sign", () => {
    expect(scanDist(dist)).toEqual([]);
  });

  test("3. before the wallet opens, the page shows the offer, payee, amount, chain, escrow, job and what happens next", () => {
    const now = 1_793_980_000;
    const choice = trustedRequirement([req], listing);
    expect(choice.ok).toBe(true);
    const pending = pendingOf(listing, { question: "q" }, req, buildAuthorization(req, buyer, now, `0x${"11".repeat(32)}`), "https://hub.example");
    const html = renderToString(
      createElement(SignReview, { pending, busy: false, onConfirm: () => {}, onCancel: () => {}, testIdPrefix: "start" }),
    );
    expect(html).toContain("Before your wallet opens");
    expect(html).toContain("use-arc");
    expect(html).toContain(`data-value="${seller}"`);
    expect(html).toContain('data-value="10000"');
    expect(html).toContain("Arc testnet");
    expect(html).toContain(`data-value="${pending.jobId}"`);
    expect(html).toContain("Sign in my wallet");
    expect(nextWords(pending)).toContain("for job");
    expect(nextWords(pending)).toContain("only if the output checks out");
  });

  test("4. every signature is scoped to one job: the typed data's nonce is the job id the review shows", () => {
    const auth = buildAuthorization(req, buyer, 1_793_980_000, `0x${"22".repeat(32)}`);
    const pending = pendingOf(listing, {}, req, auth, "https://hub.example");
    const typed = authorizationTypedData(auth);
    expect(typed.message.nonce).toBe(jobIdOf(auth.terms, auth.chainId, auth.escrow));
    expect(typed.message.nonce).toBe(pending.jobId);
    // A different salt is a different job, so one signature can never fund two.
    const other = buildAuthorization(req, buyer, 1_793_980_000, `0x${"33".repeat(32)}`);
    expect(authorizationTypedData(other).message.nonce).not.toBe(typed.message.nonce);
  });

  // The only places a wallet may sign, each where its signature settles (STEER-2225 point 5): the buyer's
  // purchase through the hub, and the merchant's refund through our relay (captain's ruling on cs-phone's W2).
  const SIGNING_SITES = ["lib/purchase.ts", "routes/merchant/WalletRefund.tsx", "routes/merchant/wallet-refund.ts"];

  test("5. the wallet opens only where its signature settles: the purchase's confirm() and the merchant's refund", () => {
    const signers = sources.filter((s) => /signTypedData/.test(s.text)).map((s) => s.file);
    for (const file of signers) expect({ file, allowed: SIGNING_SITES.includes(file) }).toEqual({ file, allowed: true });
    expect(signers).toContain("lib/purchase.ts");
    const purchase = sources.find((s) => s.file === "lib/purchase.ts")!.text;
    expect(purchase.match(/signTypedDataAsync\(/g)).toHaveLength(1);
    const confirm = purchase.slice(purchase.indexOf("const confirm = async"), purchase.indexOf("const cancel = "));
    expect(confirm).toContain("signTypedDataAsync(authorizationTypedData(p.authorization))");
    // buy() only asks the hub and checks its terms; it never opens the wallet.
    const buy = purchase.slice(purchase.indexOf("const buy = async"), purchase.indexOf("const confirm = async"));
    expect(buy).not.toMatch(/signTypedData/);
  });

  test("5. the merchant's refund signs once, inside sendWalletRefund, after the relay's refusals are checked", () => {
    const logic = sources.find((s) => s.file === "routes/merchant/wallet-refund.ts");
    const ui = sources.find((s) => s.file === "routes/merchant/WalletRefund.tsx");
    // Before cs-phone's phone-06 lands neither file exists, and nothing else may sign (the test above).
    if (!logic || !ui) return;
    expect(logic.text.match(/\.signTypedData\(/g)).toHaveLength(1);
    const send = logic.text.slice(logic.text.indexOf("export async function sendWalletRefund"));
    expect(send).toContain("input.signTypedData(");
    expect(logic.text).toContain("export function walletRefusal(");
    // The hook's signer is handed only to sendWalletRefund; the component never signs on its own.
    expect(ui.text.match(/signTypedDataAsync\(/g)).toHaveLength(1);
    expect(ui.text).toContain("sendWalletRefund({");
  });
});
