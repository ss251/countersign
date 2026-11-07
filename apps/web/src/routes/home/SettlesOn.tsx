import type { JSX } from "react";
import type { RailDeclaration } from "../../lib/types.ts";
import { NETWORK_SITE, NETWORKS, NetworkMark, railNetwork, type Network } from "../../ui/NetworkMark.tsx";

/**
 * "Settles on" (STEER-0713b): the networks with a rail this hub serves, each with its own mark and a link to
 * its site. Until the hub answers it shows all three, the networks the hub serves today, so the row never
 * jumps; once the hub answers it shows only the networks that have a live rail.
 */
export function settlingNetworks(rails: RailDeclaration[] | undefined): Network[] {
  if (rails === undefined) return NETWORKS;
  const live = new Set(rails.map((r) => railNetwork(r.id)).filter((n): n is Network => n !== null));
  return NETWORKS.filter((n) => live.has(n));
}

export function SettlesOn({ rails }: { rails: RailDeclaration[] | undefined }): JSX.Element | null {
  const networks = settlingNetworks(rails);
  if (networks.length === 0) return null;
  return (
    <section className="settles" aria-labelledby="settles-title" data-testid="settles-on">
      <h2 id="settles-title" className="settles__title label">
        Settles on
      </h2>
      <ul className="settles__list">
        {networks.map((network) => (
          <li key={network}>
            <a className="settles__link" href={NETWORK_SITE[network].href} target="_blank" rel="noopener noreferrer">
              <NetworkMark network={network} size={20} />
              {NETWORK_SITE[network].name}
            </a>
          </li>
        ))}
      </ul>
      <p className="settles__note">
        Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. The Hedera and Whitechain marks belong
        to their owners.
      </p>
    </section>
  );
}
