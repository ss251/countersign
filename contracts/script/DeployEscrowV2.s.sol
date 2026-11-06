// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";

/// @notice Deploys CountersignedEscrow v2.1 against an existing treasury (v1's FeeSplit) and records it in
///         contracts/deployments/<DEPLOYMENT_NAME>.json.
/// Env: CS_DEPLOYER_KEY (never on the command line), ESCROW_TOKEN, ESCROW_TREASURY, ARBITER,
///      ESCROW_TOLL_BPS (default 100), DEPLOYMENT_NAME (e.g. arc-testnet-v2).
contract DeployEscrowV2 is Script {
    function run() external returns (CountersignedEscrow escrow) {
        uint256 key = vm.envUint("CS_DEPLOYER_KEY");
        address token = vm.envAddress("ESCROW_TOKEN");
        address treasury = vm.envAddress("ESCROW_TREASURY");
        address arbiter = vm.envAddress("ARBITER");
        uint16 tollBps = uint16(vm.envOr("ESCROW_TOLL_BPS", uint256(100)));

        vm.startBroadcast(key);
        escrow = new CountersignedEscrow(token, treasury, tollBps, arbiter);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "token", token);
        vm.serializeAddress(o, "treasury", treasury);
        vm.serializeAddress(o, "arbiter", arbiter);
        vm.serializeUint(o, "tollBps", tollBps);
        vm.serializeUint(o, "block", block.number);
        string memory json = vm.serializeAddress(o, "escrow", address(escrow));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/contracts/deployments/", vm.envString("DEPLOYMENT_NAME"), ".json"));
    }
}
