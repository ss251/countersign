// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";

/// @dev The same vectors are asserted in packages/core/test/countersign-v2.test.ts, so the
///      TypeScript jobIdOf (v2 terms) and the contract's jobIdFor cannot drift apart. The v1
///      vector (0x1106…51c9) stays in packages/core/test/countersign.test.ts for v1 escrows.
contract ParityTest is Test {
    address internal constant AT = 0x4444444444444444444444444444444444444444;

    function setUp() public {
        vm.chainId(5042002);
        deployCodeTo(
            "CountersignedEscrow.sol:CountersignedEscrow",
            abi.encode(address(1), address(2), uint16(100), address(3)),
            AT
        );
    }

    function _jobId(uint256 bond, uint64 reviewWindow) internal view returns (bytes32) {
        return CountersignedEscrow(AT).jobIdFor(
            0x1111111111111111111111111111111111111111111111111111111111111111,
            0x2222222222222222222222222222222222222222,
            0x3333333333333333333333333333333333333333,
            1_500_000,
            1_762_400_300,
            42,
            bond,
            reviewWindow
        );
    }

    function test_v2_jobId_matches_the_typescript_vector() public view {
        assertEq(_jobId(500_000, 3600), 0x828d7c08e5ceaa062bb376176a187ea3ca6f5b1100b4f7d61c55d4b9dd847790);
    }

    function test_v2_jobId_with_bond_and_window_zero_matches_the_typescript_vector() public view {
        assertEq(_jobId(0, 0), 0x734bac74d246f2670a8a73fd546e8e780aef62c74a7976c6fba258bcabb77f11);
    }
}
