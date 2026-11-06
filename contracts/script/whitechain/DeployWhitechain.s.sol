// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CountersignedEscrow} from "../../src/CountersignedEscrow.sol";
import {FeeSplit} from "../../src/FeeSplit.sol";

/// Deploys countersign's escrow on Whitechain Sepolia, settling in USDT, with a FeeSplit as its
/// treasury. By default the toll is split between the relayer, whose share buys back the WBT it
/// spends on gas, and the deployer. Writes contracts/deployments/whitechain-sepolia.json.
///
///   set -a; . ~/.config/countersign/wc.env; set +a
///   forge script contracts/script/whitechain/DeployWhitechain.s.sol:DeployWhitechain \
///     --rpc-url https://rpc.testnet.whitechain.io --broadcast --slow \
///     --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/
///
/// Env: WC_DEPLOYER_PRIVATE_KEY (required); WC_RELAYER_ADDRESS (required unless
/// WC_FEESPLIT_PAYEES is set); WC_TOLL_BPS (default 100); WC_FEESPLIT_PAYEES and
/// WC_FEESPLIT_SHARES (comma separated, shares in bps summing to 10000).
contract DeployWhitechain is Script {
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    string internal constant OUT = "contracts/deployments/whitechain-sepolia.json";

    function run() external returns (CountersignedEscrow escrow, FeeSplit split) {
        require(block.chainid == 1874, "DeployWhitechain: not Whitechain Sepolia");
        uint256 key = vm.envUint("WC_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        uint16 tollBps = uint16(vm.envOr("WC_TOLL_BPS", uint256(100)));
        (address[] memory payees, uint16[] memory shares) = _split(deployer);

        address arbiter = vm.envOr("WC_ARBITER_ADDRESS", payees[0]);

        vm.startBroadcast(key);
        split = new FeeSplit(payees, shares);
        escrow = new CountersignedEscrow(USDT, address(split), tollBps, arbiter);
        vm.stopBroadcast();

        require(address(escrow.token()) == USDT, "token");
        require(escrow.treasury() == address(split), "treasury");
        require(escrow.tollBps() == tollBps, "toll");

        string memory k = "whitechain";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeString(k, "network", "eip155:1874");
        vm.serializeAddress(k, "token", USDT);
        vm.serializeAddress(k, "feeSplit", address(split));
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "payees", payees);
        vm.serializeUint(k, "tollBps", tollBps);
        vm.serializeUint(k, "block", block.number);
        vm.serializeBytes32(k, "escrowDomainSeparator", escrow.domainSeparator());
        string memory json = vm.serializeAddress(k, "escrow", address(escrow));
        vm.writeJson(json, OUT);

        console2.log("escrow:", address(escrow));
        console2.log("feeSplit:", address(split));
        console2.log("tollBps:", tollBps);
    }

    function _split(address deployer) internal view returns (address[] memory payees, uint16[] memory shares) {
        if (vm.envExists("WC_FEESPLIT_PAYEES")) {
            payees = vm.envAddress("WC_FEESPLIT_PAYEES", ",");
            uint256[] memory raw = vm.envUint("WC_FEESPLIT_SHARES", ",");
            require(raw.length == payees.length, "DeployWhitechain: payees and shares differ in length");
            shares = new uint16[](raw.length);
            for (uint256 i; i < raw.length; ++i) {
                require(raw[i] <= 10_000, "DeployWhitechain: share above 10000");
                shares[i] = uint16(raw[i]);
            }
            return (payees, shares);
        }
        payees = new address[](2);
        shares = new uint16[](2);
        payees[0] = vm.envAddress("WC_RELAYER_ADDRESS");
        payees[1] = deployer;
        shares[0] = 5_000;
        shares[1] = 5_000;
    }
}
