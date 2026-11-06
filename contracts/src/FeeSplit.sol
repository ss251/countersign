// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FeeSplit
/// @notice The escrow's treasury. Splits whatever toll it holds between fixed payees by fixed shares.
///         Anyone may call distribute; nobody can change the split.
contract FeeSplit {
    using SafeERC20 for IERC20;

    event Distributed(address indexed token, uint256 total);

    error BadSplit();

    address[] private _payees;
    uint16[] private _sharesBps;

    constructor(address[] memory payees_, uint16[] memory sharesBps_) {
        uint256 n = payees_.length;
        if (n == 0 || n != sharesBps_.length) revert BadSplit();
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (payees_[i] == address(0) || sharesBps_[i] == 0) revert BadSplit();
            sum += sharesBps_[i];
        }
        if (sum != 10_000) revert BadSplit();
        _payees = payees_;
        _sharesBps = sharesBps_;
    }

    /// @notice Pay out this contract's whole balance of `token`. The last payee takes the rounding dust.
    function distribute(IERC20 token) external {
        uint256 total = token.balanceOf(address(this));
        if (total == 0) return;
        uint256 n = _payees.length;
        uint256 sent;
        for (uint256 i; i < n - 1; ++i) {
            uint256 part = (total * _sharesBps[i]) / 10_000;
            sent += part;
            token.safeTransfer(_payees[i], part);
        }
        token.safeTransfer(_payees[n - 1], total - sent);
        emit Distributed(address(token), total);
    }

    function payees() external view returns (address[] memory, uint16[] memory) {
        return (_payees, _sharesBps);
    }
}
