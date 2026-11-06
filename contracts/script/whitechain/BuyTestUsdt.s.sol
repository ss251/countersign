// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IBalance {
    function balanceOf(address account) external view returns (uint256);
}

/// Buys test USDT with test WBT on the public WWBT/USDT pool of Whitechain Sepolia.
/// There is no USDT faucet on chain 1874; this is how the demo buyer gets the prize token.
///
/// Env:
///   WC_SWAP_SIGNER       role whose key pays, e.g. RELAYER (reads WC_<role>_PRIVATE_KEY)
///   WC_SWAP_RECIPIENT    address that receives the USDT
///   WC_SWAP_WBT_WEI      WBT to spend, in wei
///   WC_SWAP_MIN_USDT     minimum USDT out, atomic (6 decimals)
contract BuyTestUsdt is Script {
    address internal constant ROUTER = 0xe208cC685cD95D56E8ec6DEC9816476567fc6962;
    address internal constant WWBT = 0x4200000000000000000000000000000000000006;
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    uint24 internal constant POOL_FEE = 3000;

    function run() external returns (uint256 amountOut) {
        require(block.chainid == 1874, "BuyTestUsdt: not Whitechain Sepolia");
        uint256 key = vm.envUint(string.concat("WC_", vm.envString("WC_SWAP_SIGNER"), "_PRIVATE_KEY"));
        address recipient = vm.envAddress("WC_SWAP_RECIPIENT");
        uint256 amountIn = vm.envUint("WC_SWAP_WBT_WEI");
        uint256 minOut = vm.envUint("WC_SWAP_MIN_USDT");
        require(amountIn > 0 && minOut > 0, "BuyTestUsdt: zero amount");

        uint256 before = IBalance(USDT).balanceOf(recipient);
        vm.startBroadcast(key);
        amountOut = ISwapRouter02(ROUTER).exactInputSingle{value: amountIn}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WWBT,
                tokenOut: USDT,
                fee: POOL_FEE,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopBroadcast();

        require(IBalance(USDT).balanceOf(recipient) == before + amountOut, "BuyTestUsdt: balance did not move");
        console2.log("USDT out (atomic):", amountOut);
        console2.log("recipient:", recipient);
    }
}
