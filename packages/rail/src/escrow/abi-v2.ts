// Hand-written escrow v2 fragment (#98, docs/spec/escrow.md "Escrow v2"). It is replaced by the
// generated ABI from `forge inspect CountersignedEscrow abi --json` when the contract lands.
//
// The Countersignature field order is part of the wire contract: bond and reviewWindow sit after
// salt, inside the buyer's countersigned jobId, and before the EIP-3009 authorisation fields.
export const escrowV2Abi = [
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerHash", type: "bytes32" },
      {
        name: "cs",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "salt", type: "uint256" },
          { name: "bond", type: "uint256" },
          { name: "reviewWindow", type: "uint64" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "lockSig", type: "bytes" },
    ],
    outputs: [{ name: "jobId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "accept",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "buyerSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "status", type: "uint8" },
      { name: "buyerSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "releaseAfterWindow",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reviewOf",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      { name: "window", type: "uint64" },
      { name: "deliveredAt", type: "uint64" },
      { name: "endsAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "sweepToll",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "setTerms",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerHash", type: "bytes32" },
      { name: "price", type: "uint256" },
      { name: "bond", type: "uint256" },
      { name: "reviewWindow", type: "uint64" },
      { name: "minDuration", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "bondOfJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
