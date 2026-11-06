import { networkName, RAIL_LABEL } from "../lib/format.ts";
import type { RailDeclaration } from "../lib/types.ts";
import { Hash, KV } from "./primitives.tsx";

const KIND: Record<RailDeclaration["kind"], string> = {
  escrow: "Escrow. The money locks in a contract until release or refund.",
  direct: "Direct. One transfer, final when it lands.",
  batched: "Batched. The buyer is debited at once and the seller credited in a later batch.",
};

const GAS: Record<RailDeclaration["gasPaidBy"], string> = {
  hub: "The hub",
  relayer: "Our relayer",
  facilitator: "The x402 facilitator",
  gateway: "Circle Gateway",
};

/** A rail, declared in data: what moved the money and when it counts as settled. */
export function RailCard({ declaration: d, tx }: { declaration: RailDeclaration; tx?: string }) {
  const explorer = tx ? d.explorerTx.replace("{tx}", encodeURIComponent(tx)) : undefined;
  return (
    <KV
      className="rail-card"
      rows={[
        ["Rail", <strong>{RAIL_LABEL[d.id]}</strong>],
        ["How", KIND[d.kind]],
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
        ["Gas", `${GAS[d.gasPaidBy]} pays it. The buyer never does.`],
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
