import { getAddress, recoverTypedDataAddress } from "viem";
import type { Address, Hex, LocalAccount, TypedDataDomain } from "viem";
import { atomicToWire, parseAtomic } from "@countersign/core";
import { USDT, WHITECHAIN_CHAIN_ID } from "./chain.ts";

const NONCE = /^0x[0-9a-fA-F]{64}$/;

export class PayloadError extends Error {
  override name = "PayloadError";
}

export type Authorization = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

export type WireAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const tokenAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AuthorizationUsed",
    inputs: [
      { name: "authorizer", type: "address", indexed: true },
      { name: "nonce", type: "bytes32", indexed: true },
    ],
  },
] as const;

export function usdtDomain(): TypedDataDomain {
  return {
    name: USDT.name,
    version: USDT.version,
    chainId: WHITECHAIN_CHAIN_ID,
    verifyingContract: USDT.address,
  };
}

export function authorizationFromWire(wire: WireAuthorization): Authorization {
  if (!wire || typeof wire !== "object") {
    throw new PayloadError("authorization is not an object");
  }
  return {
    from: parseAddress(wire.from, "from"),
    to: parseAddress(wire.to, "to"),
    value: parseAmount(wire.value, "value"),
    validAfter: parseAmount(wire.validAfter, "validAfter"),
    validBefore: parseAmount(wire.validBefore, "validBefore"),
    nonce: parseNonce(wire.nonce),
  };
}

export function authorizationToWire(auth: Authorization): WireAuthorization {
  return {
    from: auth.from,
    to: auth.to,
    value: atomicToWire(auth.value),
    validAfter: atomicToWire(auth.validAfter),
    validBefore: atomicToWire(auth.validBefore),
    nonce: auth.nonce,
  };
}

export async function signAuthorization(account: LocalAccount, auth: Authorization): Promise<Hex> {
  return account.signTypedData({
    domain: usdtDomain(),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
  });
}

export async function recoverAuthorizer(auth: Authorization, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({
    domain: usdtDomain(),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
    signature,
  });
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string") {
    throw new PayloadError(`${field} is not an address`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new PayloadError(`${field} is not an address`);
  }
}

function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== "string") {
    throw new PayloadError(`${field} is not an atomic amount`);
  }
  try {
    return parseAtomic(value);
  } catch {
    throw new PayloadError(`${field} is not an atomic amount`);
  }
}

function parseNonce(value: unknown): Hex {
  if (typeof value !== "string" || !NONCE.test(value)) {
    throw new PayloadError("nonce is not a 32-byte hex string");
  }
  return value as Hex;
}
