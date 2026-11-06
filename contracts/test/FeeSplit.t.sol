// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FeeSplit} from "../src/FeeSplit.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

contract FeeSplitTest is Test {
    MockEIP3009 internal token;
    address internal a = makeAddr("protocol");
    address internal b = makeAddr("relayer");

    function setUp() public {
        token = new MockEIP3009();
    }

    function _split(uint16 sa, uint16 sb) internal returns (FeeSplit) {
        address[] memory p = new address[](2);
        p[0] = a;
        p[1] = b;
        uint16[] memory s = new uint16[](2);
        s[0] = sa;
        s[1] = sb;
        return new FeeSplit(p, s);
    }

    function test_distribute_splits_by_share_and_the_last_payee_takes_dust() public {
        FeeSplit split = _split(8_000, 2_000);
        token.mint(address(split), 1_001);
        split.distribute(token);
        assertEq(token.balanceOf(a), 800);
        assertEq(token.balanceOf(b), 201);
        assertEq(token.balanceOf(address(split)), 0);
    }

    function test_distribute_with_nothing_is_a_no_op() public {
        FeeSplit split = _split(5_000, 5_000);
        split.distribute(token);
        assertEq(token.balanceOf(a), 0);
    }

    function test_shares_must_sum_to_10000() public {
        vm.expectRevert(FeeSplit.BadSplit.selector);
        _split(5_000, 4_999);
    }

    function test_zero_share_is_refused() public {
        vm.expectRevert(FeeSplit.BadSplit.selector);
        _split(10_000, 0);
    }
}
