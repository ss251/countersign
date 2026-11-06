import { useState } from "react";
import {
  authorizationTypedData,
  countersignPayload,
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type AuthorizationInput,
  type CountersignExtra,
  type CountersignTerms,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettleResult,
} from "@countersign/core";
import { getAddress } from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { ARC_CHAIN_ID, ARC_PIN } from "../../lib/arc-pin.ts";
import { shortHex, usd } from "../../lib/format.ts";
import { hubBase } from "../../lib/hub.ts";
import type { Address, Hex, Listing } from "../../lib/types.ts";
import { Amount, Button, FixtureNote, Hash } from "../../ui/primitives.tsx";
import { WalletButton } from "../../ui/WalletButton.tsx";
import "../../ui/page.css";
import "./start.css";

/**
 * One screen for the three roles. The buyer path is real: the connected wallet signs
 * core's own countersignature over the escrow this page pins, the hub verifies it, and
 * the answer on screen is the hub's own.
 */

export type TrustedRequirement =
  | { ok: true; req: PaymentRequirements }
  | { ok: false; message: string };

/** The Arc countersign terms this page will sign, or the sentence saying why it will not. */
export function trustedRequirement(accepts: PaymentRequirements[]): TrustedRequirement {
  const req = accepts.find((r) => r.scheme === "countersign" && r.network === "eip155:5042002");
  if (!req) return { ok: false, message: "This hub offered no Arc countersign terms for this offer." };
  const extra = req.extra;
  const named = isRecord(extra) && "escrow" in extra ? extra.escrow : undefined;
  if (named !== undefined && (typeof named !== "string" || !sameAddress(named, ARC_PIN.escrow))) {
    return {
      ok: false,
      message: "The hub's terms name an escrow this page does not trust, so nothing was signed.",
    };
  }
  return { ok: true, req };
}

/** The authorization the wallet signs, built from the pin and the hub's own terms. */
export function buildAuthorization(
  req: PaymentRequirements,
  address: Address,
  nowSeconds: number,
  salt: string,
): AuthorizationInput {
  const extra = req.extra as Partial<CountersignExtra> | undefined;
  if (!extra || typeof extra.offerHash !== "string" || typeof extra.deadlineSeconds !== "number") {
    throw new Error("The hub's terms are missing the offer hash or deadline, so nothing was signed.");
  }
  const terms: CountersignTerms = {
    offerHash: extra.offerHash as Hex,
    buyer: address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: nowSeconds + extra.deadlineSeconds,
    salt: coreSalt(salt),
  };
  return {
    terms,
    chainId: ARC_PIN.chainId,
    escrow: ARC_PIN.escrow,
    token: ARC_PIN.token,
    tokenName: ARC_PIN.tokenName,
    tokenVersion: ARC_PIN.tokenVersion,
    validAfter: 0,
    validBefore: nowSeconds + 600,
  };
}

/** The first listed, online, Arc-escrow offer, preferring use-arc. */
export function pickListing(listings: Listing[]): Listing | undefined {
  const live = listings.filter(
    (listing) => listing.status === "listed" && listing.online === true && listing.offer.rails.includes("escrow"),
  );
  return live.find((listing) => listing.offer.title === "use-arc") ?? live[0];
}

type Phase = "idle" | "signing" | "sending";

type Outcome =
  | { kind: "paid"; transaction: string | null; slipHash: Hex | null }
  | { kind: "refused"; message: string; faucet: boolean };

const QUESTION = "What does countersign do?";
const FAUCET_URL = "https://faucet.circle.com";
const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";

export default function StartPage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const account = useAccount();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [phase, setPhase] = useState<Phase>("idle");
  const [signature, setSignature] = useState<Hex | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const listing = pickListing(listings.data ?? []);
  const onArc = account.status === "connected" && account.chainId === ARC_CHAIN_ID;

  const buy = async () => {
    if (!listing || !account.address || !onArc || phase !== "idle") return;
    const base = hubBase();
    setPhase("signing");
    setSignature(null);
    setOutcome(null);
    setNote(null);
    try {
      if (!base) {
        setNote("No hub is chosen, so there is nothing to buy from this page.");
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const first = await postCall(base, listing.hash);
      const firstBody = await readJson(first);
      if (first.status !== 402) {
        if (first.ok) {
          setNote(`The hub answered ${first.status} without asking for payment, so nothing was signed.`);
          return;
        }
        const message = refusalMessage(firstBody, `The hub answered ${first.status}.`);
        setOutcome({ kind: "refused", message, faucet: needsFaucet(message, first.status) });
        return;
      }
      const required = paymentRequiredOf(firstBody, first);
      if (!required) {
        setOutcome({ kind: "refused", message: "The hub's 402 carried no payment terms.", faucet: false });
        return;
      }

      const choice = trustedRequirement(required.accepts);
      if (!choice.ok) {
        setNote(choice.message);
        return;
      }

      let input: AuthorizationInput;
      try {
        input = buildAuthorization(choice.req, account.address, now, randomSalt());
      } catch (error) {
        setNote(messageOf(error));
        return;
      }

      let sig: Hex;
      try {
        sig = await signTypedDataAsync(authorizationTypedData(input));
      } catch {
        setNote("The wallet did not sign, so nothing was sent.");
        return;
      }
      setSignature(sig);
      setPhase("sending");

      const payment: PaymentPayload = {
        x402Version: 2,
        accepted: choice.req,
        payload: countersignPayload(input, sig) as unknown as Record<string, unknown>,
      };

      let second: Response;
      try {
        second = await postCall(base, listing.hash, payment);
      } catch {
        setNote("The hub did not answer, so this page cannot say whether the payment reached it.");
        return;
      }

      const secondBody = await readJson(second);
      if (second.ok) {
        const settleHeader = second.headers.get(PAYMENT_RESPONSE_HEADER);
        const settle = settleHeader ? settleOf(settleHeader) : null;
        if (settle && settle.success === false) {
          const message = settle.errorReason ?? "The hub's settle result did not say the payment succeeded.";
          setOutcome({ kind: "refused", message, faucet: needsFaucet(message, second.status) });
          return;
        }
        setOutcome({
          kind: "paid",
          transaction: transactionOf(secondBody, settle),
          slipHash: slipHashOf(secondBody),
        });
        return;
      }

      const message = refusalMessage(secondBody, `The hub answered ${second.status}.`);
      setOutcome({ kind: "refused", message, faucet: needsFaucet(message, second.status) });
    } catch {
      setNote("The hub did not answer, so nothing here can say what happened.");
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="page start">
      <header className="page__head start__head">
        <h1 className="page__title">Start here.</h1>
        <p className="page__lede">
          countersign lets an AI agent pay for tools inside limits you sign. Pick what you came to do.
        </p>
      </header>

      <section className="start__section" aria-labelledby="start-wallet-title">
        <h2 id="start-wallet-title" className="start__title">
          I want a wallet
        </h2>
        <p className="start__text">
          Connect the wallet you have. Everything here runs on Arc testnet with test USDC, so nothing costs real money.
        </p>
        <WalletButton />
      </section>

      <section className="start__section" aria-labelledby="start-sell-title">
        <h2 id="start-sell-title" className="start__title">
          I want to sell
        </h2>
        <p className="start__text">
          Publish a tool once and get paid per call, inside each buyer's limits. Your code and keys stay on your
          machine.
        </p>
        <p>
          <Link to="/seller" className="start__link">
            Publish a tool
          </Link>
        </p>
      </section>

      <section className="start__section" data-testid="start-buy" aria-labelledby="start-buy-title">
        <h2 id="start-buy-title" className="start__title">
          I want to buy
        </h2>

        {listings.loading && !listings.data ? (
          <p className="start__text">Reading this hub's offers.</p>
        ) : listings.error ? (
          <p className="start__text">The hub did not answer, so no live offer can be read right now.</p>
        ) : !listing ? (
          <p className="start__text">No live Arc offer is listed on this hub right now.</p>
        ) : (
          <>
            <div className="start__offer" data-testid="start-offer">
              <div className="start__offer-line">
                <span className="start__offer-title">{listing.offer.title}</span>
                <Amount
                  money={usd(listing.offer.price, "escrow")}
                  flight={phase === "signing" || phase === "sending"}
                />
                <FixtureNote show={listings.source === "fixtures"} />
              </div>
              <p className="start__seller">Sold by {listing.seller.name}</p>
            </div>

            {account.status !== "connected" ? (
              <p className="start__text">Connect a wallet above to buy.</p>
            ) : (
              <div className="start__actions">
                {account.chainId !== ARC_CHAIN_ID ? (
                  <Button variant="secondary" onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}>
                    Switch to Arc testnet
                  </Button>
                ) : null}
                <Button
                  data-testid="start-countersign"
                  variant="primary"
                  disabled={!onArc || phase !== "idle"}
                  onClick={() => void buy()}
                >
                  {phase === "signing" ? "Signing" : phase === "sending" ? "Sending to the hub" : "Countersign and buy"}
                </Button>
              </div>
            )}

            {signature ? (
              <p className="start__signed" role="status">
                Signed by your wallet{" "}
                <span className="mono start__signature" data-testid="start-signature" title={signature}>
                  {shortHex(signature)}
                </span>
              </p>
            ) : null}

            {note ? (
              <p className="start__note" role="status">
                {note}
              </p>
            ) : null}

            {outcome?.kind === "paid" ? (
              <div className="start__paid" role="status">
                <p className="start__text">The output checked out, and the escrow released your payment to the seller.</p>
                {/* On escrow rails the hub answers 200 only after the release, and PAYMENT-RESPONSE carries that release. */}
                <div data-testid="start-fund-result" data-value={outcome.transaction ?? ""} data-kind="release">
                  {outcome.transaction ? (
                    <Hash
                      value={outcome.transaction}
                      href={`${ARCSCAN_TX}${outcome.transaction}`}
                      tx
                      label="release transaction"
                    />
                  ) : (
                    <span className="start__text">The hub did not name a transaction.</span>
                  )}
                </div>
                {outcome.slipHash ? (
                  <div className="start__slip" data-testid="start-slip">
                    <Hash value={outcome.slipHash} label="slip hash" />
                    <Link to={`/verify/${outcome.slipHash}`} data-testid="start-verify">
                      Check it without us
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : outcome?.kind === "refused" ? (
              <div className="start__refused" role="alert">
                <p className="start__text">The hub refused, and nothing moved:</p>
                <p className="start__message" data-testid="start-refusal">
                  {outcome.message}
                </p>
                {outcome.faucet ? (
                  <a className="start__faucet" data-testid="start-faucet" href={FAUCET_URL} target="_blank" rel="noreferrer">
                    Get test USDC for Arc at the Circle faucet
                  </a>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Core carries a salt as a decimal uint256; the page draws its bytes and hands them over that way. */
function coreSalt(salt: string): string {
  return /^0x[0-9a-fA-F]+$/.test(salt) ? BigInt(salt).toString(10) : salt;
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

async function postCall(base: string, offerHash: string, payment?: PaymentPayload): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers[PAYMENT_SIGNATURE_HEADER] = toBase64Json(payment);
  return fetch(`${base}/offers/${offerHash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { question: QUESTION } }),
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function paymentRequiredOf(body: unknown, res: Response): PaymentRequired | null {
  if (isRecord(body) && Array.isArray(body.accepts)) return body as unknown as PaymentRequired;
  const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (!header) return null;
  try {
    const parsed = fromBase64Json<PaymentRequired>(header);
    return Array.isArray(parsed.accepts) ? parsed : null;
  } catch {
    return null;
  }
}

function settleOf(header: string): SettleResult | null {
  try {
    return fromBase64Json<SettleResult>(header);
  } catch {
    return null;
  }
}

function transactionOf(body: unknown, settle: SettleResult | null): string | null {
  if (settle && typeof settle.transaction === "string" && settle.transaction !== "") return settle.transaction;
  if (isRecord(body) && isRecord(body.slip) && isRecord(body.slip.settlement)) {
    const tx = body.slip.settlement.transaction;
    if (typeof tx === "string" && tx !== "") return tx;
  }
  return null;
}

function slipHashOf(body: unknown): Hex | null {
  if (!isRecord(body) || !isRecord(body.slip)) return null;
  const hash = body.slip.hash;
  return typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hex) : null;
}

function refusalMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.message === "string" && body.message !== "") return body.message;
    if (typeof body.error === "string" && body.error !== "") return body.error;
  }
  return fallback;
}

function needsFaucet(message: string, status: number): boolean {
  if (status === 402) return true;
  return /balance|funds|allowance|insufficient/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
