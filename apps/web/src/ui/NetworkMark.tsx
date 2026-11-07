import { Fragment, type JSX } from "react";
import { RAIL_LABEL } from "../lib/format.ts";
import type { RailId } from "../lib/types.ts";
import "./netmark.css";

/**
 * Each network's own mark beside its name (STEER-0713b). The files in public/marks are the networks' official
 * marks, byte for byte:
 * - Arc: Circle's Arc logo pack, "Arc Network Icon/Arc_network.svg", the asset Arc's guidelines (3.4) name for the
 *   Arc network. It is a navy disc that reads on light and dark surfaces, so both files are that one icon.
 * - Hedera: brand.hedera.com's Hedera logo library, Logomark Hedera-Icon-Dark (light) and Hedera-Icon-White (dark).
 * - Whitechain: whitechain.io publishes no brand kit, so these are its own site's files, /icon.svg (light) and
 *   /footer-glyph.svg (dark).
 * Each sits beside its visible name, so it is decorative (alt=""). The width and height are fixed, so nothing shifts.
 */
export type Network = "arc" | "hedera" | "whitechain";

export const NETWORKS: Network[] = ["arc", "hedera", "whitechain"];

export const NETWORK_SITE: Record<Network, { name: string; href: string }> = {
  arc: { name: "Arc", href: "https://www.arc.io" },
  hedera: { name: "Hedera", href: "https://hedera.com" },
  whitechain: { name: "Whitechain", href: "https://whitechain.io" },
};

const RAIL_NETWORK: Partial<Record<RailId, Network>> = {
  escrow: "arc",
  eip3009: "arc",
  gateway: "arc",
  erc8183: "arc",
  whitechain: "whitechain",
  hedera: "hedera",
  "hedera-scheduled": "hedera",
};

/** The network a rail settles on, or null for a rail with none of the three (Stripe's MPP). */
export function railNetwork(rail: RailId): Network | null {
  return RAIL_NETWORK[rail] ?? null;
}

/** "Arc testnet", "Whitechain Sepolia", "Hedera testnet": the network a display name means. */
export function namedNetwork(name: string): Network | null {
  if (/^Arc\b/.test(name)) return "arc";
  if (/^Whitechain\b/.test(name)) return "whitechain";
  if (/^Hedera\b/.test(name)) return "hedera";
  return null;
}

export function NetworkMark({ network, size = 16 }: { network: Network; size?: 16 | 18 | 20 }): JSX.Element {
  return (
    <span className="netmark" data-network={network}>
      <img className="netmark__light" src={`/marks/${network}-light.svg`} alt="" width={size} height={size} decoding="async" draggable={false} />
      <img className="netmark__dark" src={`/marks/${network}-dark.svg`} alt="" width={size} height={size} decoding="async" draggable={false} />
    </span>
  );
}

/** A rail's name with its network's mark in front, when it has one. */
export function RailName({ rail }: { rail: RailId }): JSX.Element {
  const network = railNetwork(rail);
  return (
    <span className="netname">
      {network ? <NetworkMark network={network} /> : null}
      {RAIL_LABEL[rail]}
    </span>
  );
}

/** A network's display name ("Arc testnet") with its mark in front, when it is one of the three. */
export function NetworkName({ name }: { name: string }): JSX.Element {
  const network = namedNetwork(name);
  return (
    <span className="netname">
      {network ? <NetworkMark network={network} /> : null}
      {name}
    </span>
  );
}

/** Several rails, comma-separated, each with its mark. */
export function RailNames({ rails }: { rails: readonly RailId[] }): JSX.Element {
  return (
    <>
      {rails.map((rail, i) => (
        <Fragment key={rail}>
          {i > 0 ? ", " : null}
          <RailName rail={rail} />
        </Fragment>
      ))}
    </>
  );
}

/** Several network names, comma-separated, each with its mark. */
export function NetworkNames({ names }: { names: readonly string[] }): JSX.Element {
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 ? ", " : null}
          <NetworkName name={name} />
        </Fragment>
      ))}
    </>
  );
}
