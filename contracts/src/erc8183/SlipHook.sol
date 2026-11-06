// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IJobHook} from "./IJobHook.sol";

/// @notice Commits the slip when an ERC-8183 job is settled.
///         The escrow is the only caller. On `complete`, `data` is
///         `abi.encode(bytes32 slipHash, bytes optParams)` and `optParams` is
///         `abi.encode(bytes32 countersignJobId)`.
contract SlipHook is IJobHook {
    address public immutable escrow;
    bytes4 public immutable completeSelector;

    event SlipCommitted(uint256 indexed acpJobId, bytes32 indexed jobId, bytes32 slipHash);

    error NotEscrow();
    error ZeroSlip();

    constructor(address escrow_, bytes4 completeSelector_) {
        if (escrow_ == address(0)) revert NotEscrow();
        escrow = escrow_;
        completeSelector = completeSelector_;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external view {
        if (msg.sender != escrow) revert NotEscrow();
    }

    function afterAction(uint256 acpJobId, bytes4 selector, bytes calldata data) external {
        if (msg.sender != escrow) revert NotEscrow();
        if (selector != completeSelector) return;
        (bytes32 slipHash, bytes memory optParams) = abi.decode(data, (bytes32, bytes));
        if (slipHash == bytes32(0)) revert ZeroSlip();
        bytes32 jobId = abi.decode(optParams, (bytes32));
        emit SlipCommitted(acpJobId, jobId, slipHash);
    }
}
