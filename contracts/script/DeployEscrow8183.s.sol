// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {JobHook} from "../src/JobHook.sol";
import {CountersignedEscrow8183} from "../src/CountersignedEscrow8183.sol";

/// @notice Deploys the JobHook and the ERC-8183 escrow adapter. Not run by the tests.
contract DeployEscrow8183 is Script {
    address internal constant CORE = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (JobHook hook, CountersignedEscrow8183 escrow) {
        uint256 deployerKey = vm.envUint("CS_DEPLOYER_KEY");
        address treasury = vm.envAddress("ESCROW8183_TREASURY");
        uint16 toll = uint16(vm.envOr("ESCROW_TOLL_BPS", uint256(100)));

        vm.startBroadcast(deployerKey);
        hook = new JobHook();
        escrow = new CountersignedEscrow8183(USDC, CORE, address(hook), treasury, toll);
        vm.stopBroadcast();

        console.log("JobHook", address(hook));
        console.log("CountersignedEscrow8183", address(escrow));
    }
}
