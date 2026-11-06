import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import type { Order, RefundReason } from "./model.ts";
import { Sheet } from "./Panel.tsx";
import {
  declinedInWallet,
  refundTerms,
  sendWalletRefund,
  walletRefundIsCancel,
  walletRefusal,
  WHITECHAIN_CHAIN_ID,
} from "./wallet-refund.ts";

export type WalletRefundOutcome =
  | { kind: "done"; txHash: string; refunded?: string }
  | { kind: "refused"; reason: string }
  | { kind: "unknown"; reason: string }
  /** The merchant closed the sheet, or declined in the wallet: nothing was sent. */
  | { kind: "closed" };

interface WalletRefundProps {
  order: Order;
  amount: bigint;
  reason?: RefundReason;
  relayUrl: string;
  /** The escrow the relayer calls, from its /status: a cancel is signed for that contract and no other. */
  escrow?: string;
  hubTitle?: string | null;
  onFinish: (outcome: WalletRefundOutcome) => void;
}

type Stage = "ready" | "switching" | "signing" | "sending";

/**
 * The merchant reads exactly what will be signed before the wallet opens (STEER-2225 Fix 3):
 * who gets the money, how much, on which chain, for which job, and what happens next. The wallet
 * opens only on the merchant's click, and only on Whitechain; a network switch is its own click.
 */
export function WalletRefund({ order, amount, reason, relayUrl, escrow, hubTitle, onFinish }: WalletRefundProps): ReactNode {
  const { address, chainId, chain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [stage, setStage] = useState<Stage>("ready");
  const [problem, setProblem] = useState<string | null>(null);

  const terms = refundTerms(order, amount, hubTitle);
  const cancel = walletRefundIsCancel(order);
  const onWhitechain = chainId === WHITECHAIN_CHAIN_ID;
  const busy = stage !== "ready";

  const titleRef = useRef<HTMLHeadingElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);

  // The sheet opens on its title, never on the money button: a stray Enter must not start a refund.
  // This runs after the Sheet's own effect, which has already opened the dialog.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  // After a switch, the switch button is gone: focus moves on to the action it unlocked.
  useEffect(() => {
    if (switched.current && onWhitechain && !busy) {
      switched.current = false;
      primaryRef.current?.focus();
    }
  }, [onWhitechain, busy]);

  const switchNetwork = async () => {
    if (busy) return;
    setProblem(null);
    setStage("switching");
    try {
      await switchChainAsync({ chainId: WHITECHAIN_CHAIN_ID });
      switched.current = true;
    } catch (error) {
      setProblem(
        declinedInWallet(error)
          ? "Your wallet stayed on its network. Nothing was signed."
          : "Your wallet could not switch to Whitechain. Switch it there yourself, then try again.",
      );
    } finally {
      setStage("ready");
    }
  };

  const sign = async () => {
    if (!address || busy || !onWhitechain) return;
    // The wallet may have changed accounts while the sheet was open: check again before it signs.
    const refusal = walletRefusal(order, address, null);
    if (refusal) {
      setProblem(refusal);
      return;
    }
    setProblem(null);
    setStage("signing");
    const outcome = await sendWalletRefund({
      order,
      amount,
      relayUrl,
      address: address as Address,
      ...(reason ? { reason } : {}),
      ...(escrow ? { escrow } : {}),
      signTypedData: (typedData) => signTypedDataAsync(typedData as Parameters<typeof signTypedDataAsync>[0]),
      // Signed: from here the relayer has it, so the sheet says so.
      onSigned: () => setStage("sending"),
    });
    if (outcome.kind === "declined" || outcome.kind === "unsigned") {
      setStage("ready");
      setProblem(
        outcome.kind === "declined"
          ? "You declined in your wallet. Nothing was sent."
          : "Your wallet could not sign the refund. Nothing was sent.",
      );
      return;
    }
    onFinish(outcome);
  };

  const primary =
    stage === "signing"
      ? "Confirm in your wallet…"
      : stage === "sending"
        ? "Sending to the relayer…"
        : cancel
          ? "Sign the cancel"
          : "Sign the refund";

  return (
    <Sheet label={cancel ? "Cancel and return the payment" : "Refund from your wallet"} locked={busy} onClose={() => onFinish({ kind: "closed" })}>
      <div className="mx-wallet">
        <h2 className="mx-wallet__title" ref={titleRef} tabIndex={-1}>
          {cancel ? "Cancel and return the payment" : "Refund from your wallet"}
        </h2>

        <dl className="mx-facts">
          {terms.rows.map((row) => (
            <div className="mx-fact" key={row.label}>
              <dt>{row.label}</dt>
              <dd className={[row.mono ? "mono" : "", row.money ? "mx-money num" : ""].join(" ").trim() || undefined} title={row.mono ? row.value : undefined}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mx-wallet__line">{terms.signs}</p>
        <p className="mx-wallet__line mx-quiet">{terms.happens}</p>

        {!onWhitechain ? (
          <div className="mx-wallet__network">
            <p className="mx-wallet__line">
              Your wallet is on {chain?.name ?? (chainId ? `chain ${chainId}` : "another network")}. The refund is signed for
              Whitechain testnet (1874), so switch first. Switching signs nothing.
            </p>
            <button type="button" className="mx-button" onClick={() => void switchNetwork()} disabled={busy}>
              {stage === "switching" ? "Switching…" : "Switch to Whitechain"}
            </button>
          </div>
        ) : null}

        {problem ? (
          <p className="mx-wallet__problem" role="alert">
            {problem}
          </p>
        ) : null}

        <div className="mx-wallet__actions">
          <button
            ref={primaryRef}
            type="button"
            className="mx-button mx-button--money"
            onClick={() => void sign()}
            disabled={busy || !onWhitechain || !address}
            aria-busy={stage === "signing" || stage === "sending"}
          >
            {primary}
          </button>
          <button type="button" className="mx-button mx-button--quiet" onClick={() => onFinish({ kind: "closed" })} disabled={busy}>
            Keep it
          </button>
        </div>
      </div>
    </Sheet>
  );
}
