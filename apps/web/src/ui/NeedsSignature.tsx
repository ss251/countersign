import { useAccount } from "wagmi";
import { Link } from "../app/router.tsx";
import { hasRoute } from "../app/routes.ts";
import { chainName, shortAddress } from "../lib/wallet.ts";

/*
 * What a wallet can do from here, and no more (STEER-2120). The assistant's hold signs nothing, so
 * a real purchase with your own wallet happens on the start-here page. The line shows only once that
 * page exists; until then the card's own lines say how the agent signs.
 */
export function NeedsSignature() {
  const account = useAccount();
  if (!hasRoute("start")) return null;
  return (
    <p className="needs-sig">
      {account.status === "connected" ? (
        <>
          Your wallet <span className="mono">{shortAddress(account.address)}</span> on {chainName(account.chainId)} can
          countersign a real purchase on <Link to="/start">Start here</Link>.
        </>
      ) : (
        <>
          To buy with your own wallet instead, go to <Link to="/start">Start here</Link>.
        </>
      )}
    </p>
  );
}
