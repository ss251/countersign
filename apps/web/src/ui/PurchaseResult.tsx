import { Link } from "../app/router.tsx";
import { shortHex } from "../lib/format.ts";
import type { PurchaseOutcome } from "../lib/purchase.ts";
import type { Hex } from "../lib/types.ts";
import { Hash } from "./primitives.tsx";
import "./purchase.css";

const FAUCET_URL = "https://faucet.circle.com";
const ARCSCAN_TX = "https://testnet.arcscan.app/tx/";

/** The wallet's signature, the page's note, and the hub's paid or refused answer. */
export function PurchaseResult({
  signature,
  note,
  outcome,
  testIdPrefix,
}: {
  signature: Hex | null;
  note: string | null;
  outcome: PurchaseOutcome | null;
  testIdPrefix: "start" | "pcard";
}) {
  return (
    <>
      {signature ? (
        <p className="purchase__signed" role="status">
          Signed by your wallet{" "}
          <span className="mono purchase__signature" data-testid={`${testIdPrefix}-signature`} title={signature}>
            {shortHex(signature)}
          </span>
        </p>
      ) : null}

      {note ? (
        <p className="purchase__note" role="status" data-testid={`${testIdPrefix}-note`}>
          {note}
        </p>
      ) : null}

      {outcome?.kind === "paid" ? (
        <div className="purchase__paid" role="status">
          <p className="purchase__text">The escrow holds your payment until the output checks out.</p>
          <div data-testid={`${testIdPrefix}-fund-result`}>
            {outcome.transaction ? (
              <Hash value={outcome.transaction} href={`${ARCSCAN_TX}${outcome.transaction}`} tx label="transaction" />
            ) : (
              <span className="purchase__text">The hub did not name a transaction.</span>
            )}
          </div>
          {outcome.slipHash ? (
            <div className="purchase__slip" data-testid={`${testIdPrefix}-slip`}>
              <Hash value={outcome.slipHash} label="slip hash" />
              <Link to={`/verify/${outcome.slipHash}`} data-testid={`${testIdPrefix}-verify`}>
                Check it without us
              </Link>
            </div>
          ) : null}
        </div>
      ) : outcome?.kind === "refused" ? (
        <div className="purchase__refused" role="alert">
          <p className="purchase__text">The hub refused, and nothing moved:</p>
          <p className="purchase__message" data-testid={`${testIdPrefix}-refusal`}>
            {outcome.message}
          </p>
          {outcome.faucet ? (
            <a className="purchase__faucet" data-testid={`${testIdPrefix}-faucet`} href={FAUCET_URL} target="_blank" rel="noreferrer">
              Get test USDC for Arc at the Circle faucet
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
