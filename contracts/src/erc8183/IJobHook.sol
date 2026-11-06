// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ERC-8183 hook. The escrow calls these around every hookable action.
///         `claimRefund` is not hookable, so an expiry refund cannot be blocked.
///         `data` is the action's own encoding: for `complete` it is
///         `abi.encode(bytes32 slipHash, bytes optParams)`.
interface IJobHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
