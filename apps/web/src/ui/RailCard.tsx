import { networkName, RAIL_LABEL } from "../lib/format.ts";
import { termsKind, type TermsKind } from "../lib/terms.ts";
import type { RailDeclaration } from "../lib/types.ts";
import { Hash, KV } from "./primitives.tsx";

const KIND: Record<TermsKind, string> = {
  escrow: "Escrow. The money locks in a contract until release or refund.",
  held: "Held. A Hedera schedule moves nothing until the seller's key signs it; that key alone can also release it.",
  direct: "Direct. One transfer, final when it lands.",
  batched: "Batched. The buyer is debited at once and the seller credited in a later batch.",
};

const GAS: Record<RailDeclaration["gasPaidBy"], string> = {
  hub: "The hub",
  relayer: "Our relayer",
  facilitator: "The x402 facilitator",
  gateway: "Circle Gateway",
  buyer: "The buyer's own transaction",
};

/** A rail, declared in data: what moved the money and when it counts as settled. */
export function RailCard({ declaration: d, tx, link = true }: { declaration: RailDeclaration; tx?: string; link?: boolean }) {
  // Stand-in transactions are not on any chain, so they are never linked.
  const explorer = tx && link ? d.explorerTx.replace("{tx}", encodeURIComponent(tx)) : undefined;
  return (
    <KV
      className="rail-card"
      rows={[
        ["Rail", <strong>{RAIL_LABEL[d.id]}</strong>],
        ["How", KIND[termsKind(d)]],
        [
          "Network",
          <>
            {networkName(d.network)} <span className="mono rail-card__id">{d.network}</span>
          </>,
        ],
        [
          "Asset",
          <>
            {d.asset.symbol} <Hash value={d.asset.address} label={`${d.asset.symbol} address`} copy={false} />
          </>,
        ],
        d.escrow ? ["Escrow", <Hash value={d.escrow} label="escrow address" />] : null,
        ["Gas", d.gasPaidBy === "buyer" ? `${GAS.buyer} pays it.` : `${GAS[d.gasPaidBy]} pays it. The buyer never does.`],
        ["Final", d.finality],
        tx
          ? [
              "Transaction",
              <Hash value={tx} head={10} tail={8} href={explorer} label="settlement transaction" />,
            ]
          : null,
      ]}
    />
  );
}
