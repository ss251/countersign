// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

/// Moves test WBT between lane wallets on Whitechain Sepolia, e.g. from the relayer
/// (which the faucet funds) to the deployer before a deploy.
///
/// Env:
///   WC_TOPUP_SIGNER   role whose key pays, e.g. RELAYER (reads WC_<role>_PRIVATE_KEY)
///   WC_TOPUP_TO       recipient address
///   WC_TOPUP_WEI      amount of WBT in wei
contract TopUpWbt is Script {
    function run() external {
        require(block.chainid == 1874, "TopUpWbt: not Whitechain Sepolia");
        uint256 key = vm.envUint(string.concat("WC_", vm.envString("WC_TOPUP_SIGNER"), "_PRIVATE_KEY"));
        address to = vm.envAddress("WC_TOPUP_TO");
        uint256 amount = vm.envUint("WC_TOPUP_WEI");
        require(amount > 0, "TopUpWbt: zero amount");

        uint256 before = to.balance;
        vm.startBroadcast(key);
        (bool ok,) = payable(to).call{value: amount}("");
        vm.stopBroadcast();
        require(ok, "TopUpWbt: transfer failed");
        console2.log("sent wei:", amount);
        console2.log("recipient balance before:", before);
    }
}
