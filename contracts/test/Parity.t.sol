// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";

/// @dev The same vector is asserted in packages/core/test/countersign.test.ts, so the
///      TypeScript jobIdOf and the contract's jobIdFor cannot drift apart.
contract ParityTest is Test {
    function test_jobId_matches_the_typescript_vector() public {
        vm.chainId(5042002);
        address at = 0x4444444444444444444444444444444444444444;
        deployCodeTo(
            "CountersignedEscrow.sol:CountersignedEscrow",
            abi.encode(address(1), address(2), uint16(100), address(3)),
            at
        );
        bytes32 jobId = CountersignedEscrow(at).jobIdFor(
            0x1111111111111111111111111111111111111111111111111111111111111111,
            0x2222222222222222222222222222222222222222,
            0x3333333333333333333333333333333333333333,
            1_500_000,
            1_762_400_300,
            42
        );
        assertEq(jobId, 0x1106bd955f6f3268bd9bd592353e8f40d1bd412ad0e6c5bfd8919b1fac4951c9);
    }
}
