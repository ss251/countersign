// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IACPHook, IAgenticCommerce} from "./IAgenticCommerce.sol";

/// @title JobHook
/// @notice Commits the slip hash when an ERC-8183 job is submitted. It holds no state and
///         authorises nobody: the event names its caller, so only an event whose caller is the
///         escrow counts as a settlement.
contract JobHook is IACPHook, ERC165 {
    event SlipCommitted(uint256 indexed job, bytes32 indexed slipHash, address indexed caller);

    function beforeAction(uint256, bytes4, bytes calldata) external {}

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        if (selector != IAgenticCommerce.submit.selector) return;
        (, bytes32 deliverable,) = abi.decode(data, (address, bytes32, bytes));
        emit SlipCommitted(jobId, deliverable, msg.sender);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || super.supportsInterface(interfaceId);
    }
}
