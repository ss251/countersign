# Decisions

One entry per decision that someone could reasonably have made the other way. Newest at the bottom.

## D1 — one root tsconfig, one root foundry.toml

Bun workspaces cover `apps/*` and `packages/*`. A single `tsconfig.json` at the root typechecks every workspace, and `foundry.toml` sits at the root with its paths pointing into `contracts/`. The gate is `bun run typecheck && bun test && forge test`, run from the root, with nothing to `cd` into.

## D2 — Solidity dependencies come from `bun install`

OpenZeppelin 5.6.1 comes from npm and forge-std from its v1.17.0 tag on GitHub, both as root dev dependencies with explicit remappings. There are no git submodules, so every worktree gets a compiling contracts tree from `bun install` alone.

## D3 — `evm_version = "cancun"`

The same escrow bytecode deploys to Arc and to Whitechain Sepolia. OpenZeppelin 5.6's SignatureChecker uses MCOPY, so paris is out. On 06 Nov both chains' latest blocks carried `blobGasUsed`, `parentBeaconBlockRoot` and `requestsHash`, which means Prague-era headers, so cancun bytecode runs on both.

## D4 — amounts are bigint in code, digit strings on the wire

An amount is a bigint of the token's smallest unit everywhere in TypeScript. In JSON it is a base-10 digit string with no sign, no leading zeros and no exponent. Canonical JSON refuses non-integer numbers outright, so a float can never reach a hash or a signature.

## D5 — canonical JSON is a strict subset of RFC 8785

Keys are sorted by UTF-16 code unit, there is no whitespace, strings are escaped as `JSON.stringify` escapes them, and only safe integers are allowed as numbers. Hashes are keccak256 over the UTF-8 bytes. Anything with two possible spellings is an error rather than a normalisation.
