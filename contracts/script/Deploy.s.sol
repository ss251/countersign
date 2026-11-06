// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {FeeSplit} from "../src/FeeSplit.sol";

/// @notice Deploys FeeSplit (the treasury) and CountersignedEscrow, then records both in
///         contracts/deployments/<DEPLOYMENT_NAME>.json.
/// Env: CS_DEPLOYER_KEY (never on the command line), ESCROW_TOKEN, FEE_PROTOCOL, FEE_OPERATOR,
///      ESCROW_TOLL_BPS (default 100), DEPLOYMENT_NAME (e.g. arc-testnet).
contract Deploy is Script {
    function run() external returns (CountersignedEscrow escrow, FeeSplit split) {
        uint256 key = vm.envUint("CS_DEPLOYER_KEY");
        address token = vm.envAddress("ESCROW_TOKEN");
        uint16 tollBps = uint16(vm.envOr("ESCROW_TOLL_BPS", uint256(100)));
        address[] memory payees = new address[](2);
        payees[0] = vm.envAddress("FEE_PROTOCOL");
        payees[1] = vm.envAddress("FEE_OPERATOR");
        uint16[] memory shares = new uint16[](2);
        shares[0] = 5_000;
        shares[1] = 5_000;

        vm.startBroadcast(key);
        split = new FeeSplit(payees, shares);
        escrow = new CountersignedEscrow(token, address(split), tollBps);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "token", token);
        vm.serializeAddress(o, "feeSplit", address(split));
        vm.serializeAddress(o, "feeProtocol", payees[0]);
        vm.serializeAddress(o, "feeOperator", payees[1]);
        vm.serializeUint(o, "tollBps", tollBps);
        vm.serializeUint(o, "block", block.number);
        string memory json = vm.serializeAddress(o, "escrow", address(escrow));
        vm.writeJson(json, string.concat(vm.projectRoot(), "/contracts/deployments/", vm.envString("DEPLOYMENT_NAME"), ".json"));
    }
}
