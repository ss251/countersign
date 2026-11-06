import { useAccount, useSwitchChain } from "wagmi";
import type { PageProps } from "../../app/routes.ts";
import { Link } from "../../app/router.tsx";
import { api, useResource } from "../../lib/api.ts";
import { ARC_CHAIN_ID } from "../../lib/arc-pin.ts";
import { usd } from "../../lib/format.ts";
import { usePurchase } from "../../lib/purchase.ts";
import type { Listing } from "../../lib/types.ts";
import { chainName } from "../../lib/wallet.ts";
import { Amount, Button, FixtureNote } from "../../ui/primitives.tsx";
import { PurchaseResult } from "../../ui/PurchaseResult.tsx";
import { SignReview } from "../../ui/SignReview.tsx";
import { WalletButton } from "../../ui/WalletButton.tsx";
import "../../ui/page.css";
import "./start.css";

/**
 * One screen for the three roles. The buyer path is real: the connected wallet signs
 * core's own countersignature over the escrow this page pins, the hub verifies it, and
 * the answer on screen is the hub's own.
 */

/** The first listed, online, Arc-escrow offer, preferring use-arc. */
export function pickListing(listings: Listing[]): Listing | undefined {
  const live = listings.filter(
    (listing) => listing.status === "listed" && listing.online === true && listing.offer.rails.includes("escrow"),
  );
  return live.find((listing) => listing.offer.title === "use-arc") ?? live[0];
}

const QUESTION = "What does countersign do?";

export default function StartPage(_props: PageProps) {
  const listings = useResource(() => api.listings(), []);
  const account = useAccount();
  const { switchChain } = useSwitchChain();
  const { phase, pending, signature, signer, outcome, note, buy, confirm, cancel } = usePurchase();

  const listing = pickListing(listings.data ?? []);
  const onArc = account.status === "connected" && account.chainId === ARC_CHAIN_ID;

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
                  <>
                    {/* A switch happens only on this click, and the line says why (STEER-2225). */}
                    <p className="start__text" data-testid="start-switch-why">
                      Your wallet is on {chainName(account.chainId)}. This purchase settles on Arc testnet, so switch there first.
                    </p>
                    <Button variant="secondary" data-testid="start-switch" onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}>
                      Switch to Arc testnet
                    </Button>
                  </>
                ) : null}
                <Button
                  data-testid="start-countersign"
                  variant="primary"
                  disabled={!onArc || phase !== "idle"}
                  onClick={() => void buy(listing, { question: QUESTION })}
                >
                  {phase === "asking"
                    ? "Asking the hub for its terms"
                    : phase === "review"
                      ? "Terms below"
                      : phase === "signing"
                        ? "Signing"
                        : phase === "sending"
                          ? "Sending to the hub"
                          : "Countersign and buy"}
                </Button>
              </div>
            )}

            {pending && (phase === "review" || phase === "signing") ? (
              <SignReview
                pending={pending}
                busy={phase === "signing"}
                onConfirm={() => void confirm()}
                onCancel={cancel}
                testIdPrefix="start"
              />
            ) : null}
            <PurchaseResult signature={signature} signer={signer} note={note} outcome={outcome} testIdPrefix="start" />
          </>
        )}
      </section>
    </div>
  );
}
