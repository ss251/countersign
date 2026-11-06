/**
 * The ERC-8004 registration file a seller serves as its agent URI, and its data-URI form.
 * https://eips.ethereum.org/EIPS/eip-8004#registration-v1
 */

import { toBase64Json } from "@countersign/core";
import type { Address, Hex } from "viem";

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export interface RegistrationEndpoint {
  name: "A2A" | "agentWallet";
  endpoint: string;
}

export interface RegistrationFile {
  type: typeof REGISTRATION_TYPE;
  name: string;
  description: string;
  endpoints: RegistrationEndpoint[];
  supportedTrust: ["reputation"];
  offers: Hex[];
}

export interface RegistrationInput {
  name: string;
  description: string;
  hubUrl: string;
  seller: Address;
  offers: readonly Hex[];
  /** The chain the identity lives on, for the agentWallet endpoint. Default: Arc testnet, 5042002. */
  chainId?: number;
}

export function registrationFile(input: RegistrationInput): RegistrationFile {
  return {
    type: REGISTRATION_TYPE,
    name: input.name,
    description: input.description,
    endpoints: [
      { name: "A2A", endpoint: `${input.hubUrl}/.well-known/agent-card.json` },
      { name: "agentWallet", endpoint: `eip155:${input.chainId ?? 5042002}:${input.seller}` },
    ],
    supportedTrust: ["reputation"],
    offers: [...input.offers],
  };
}

/** The agent URI: the registration JSON, base64'd over its UTF-8 bytes, as a data URI. */
export function toDataUri(json: unknown): string {
  return `data:application/json;base64,${toBase64Json(json)}`;
}
