// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CountersignedEscrow} from "../../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../../src/ICountersignedEscrow.sol";

interface IUsdt {
    function balanceOf(address account) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

interface IRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

/// Runs CountersignedEscrow against the real USDT (TetherTokenV2) of Whitechain Sepolia, in a
/// local simulation of the live chain. Nothing is broadcast and no key is read.
///
///   forge script contracts/script/whitechain/EscrowForkCheck.s.sol --fork-url https://rpc.testnet.whitechain.io
///
/// It proves, on the token we settle in: fund pulls with one buyer signature, release pays the
/// payee less the toll, cancel and refund return the full amount, a moved price is refused, and a
/// countersignature cannot be used twice.
contract EscrowForkCheck is Script {
    address internal constant USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    address internal constant ROUTER = 0xe208cC685cD95D56E8ec6DEC9816476567fc6962;
    address internal constant WWBT = 0x4200000000000000000000000000000000000006;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint16 internal constant TOLL_BPS = 100;
    uint256 internal constant PRICE = 500_000; // 0.50 USDT

    CountersignedEscrow internal escrow;
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;
    address internal treasury;
    address internal relayer;

    function run() external {
        require(block.chainid == 1874, "EscrowForkCheck: fork Whitechain Sepolia");
        (buyer, buyerKey) = makeAddrAndKey("fork-buyer");
        (seller, sellerKey) = makeAddrAndKey("fork-seller");
        treasury = makeAddr("fork-treasury");
        relayer = makeAddr("fork-relayer");
        escrow = new CountersignedEscrow(USDT, treasury, TOLL_BPS, relayer);

        _buyUsdt(buyer, 0.05 ether);
        uint256 start = IUsdt(USDT).balanceOf(buyer);
        require(start >= 4 * PRICE, "EscrowForkCheck: swap gave too little USDT");
        console2.log("buyer USDT after swap:", start);

        // 1. fund then release: payee gets price less toll, the toll accrues and sweeps to the treasury.
        bytes32 offer1 = keccak256("offer-1");
        ICountersignedEscrow.Countersignature memory cs1 = _countersign(offer1, PRICE, uint64(block.timestamp + 600), 1);
        vm.prank(relayer);
        bytes32 job1 = escrow.fund(offer1, cs1, "");
        require(IUsdt(USDT).authorizationState(buyer, job1), "nonce not burned");
        bytes32 slip = keccak256("slip-1");
        vm.prank(relayer);
        escrow.release(job1, slip, _sign(sellerKey, _escrowDigest(keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), job1, slip)))));
        uint256 toll = PRICE * TOLL_BPS / 10_000;
        require(IUsdt(USDT).balanceOf(seller) == PRICE - toll, "payee amount");
        require(escrow.tollAccrued() == toll, "toll amount");
        escrow.sweepToll();
        require(IUsdt(USDT).balanceOf(treasury) == toll, "toll sweep");
        console2.log("1 release ok, payee got", PRICE - toll);

        // 2. a replayed countersignature is refused.
        vm.prank(relayer);
        try escrow.fund(offer1, cs1, "") {
            revert("replay was accepted");
        } catch (bytes memory err) {
            require(bytes4(err) == ICountersignedEscrow.JobExists.selector, "replay: wrong error");
        }
        console2.log("2 replay refused");

        // 3. settling at another price is refused before any money moves.
        bytes32 offer2 = keccak256("offer-2");
        ICountersignedEscrow.Countersignature memory cs2 = _countersign(offer2, PRICE, uint64(block.timestamp + 600), 2);
        cs2.amount = PRICE + 1;
        uint256 before2 = IUsdt(USDT).balanceOf(buyer);
        vm.prank(relayer);
        try escrow.fund(offer2, cs2, "") {
            revert("moved price was accepted");
        } catch (bytes memory err) {
            require(bytes4(err) == ICountersignedEscrow.CountersignatureMismatch.selector, "moved price: wrong error");
        }
        require(IUsdt(USDT).balanceOf(buyer) == before2, "moved price moved money");
        console2.log("3 moved price refused");

        // 4. the payee cancels before the deadline, through a relayer: full amount back.
        bytes32 offer3 = keccak256("offer-3");
        ICountersignedEscrow.Countersignature memory cs3 = _countersign(offer3, PRICE, uint64(block.timestamp + 600), 3);
        uint256 before3 = IUsdt(USDT).balanceOf(buyer);
        vm.prank(relayer);
        bytes32 job3 = escrow.fund(offer3, cs3, "");
        vm.prank(relayer);
        escrow.cancel(job3, _sign(sellerKey, _escrowDigest(keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), job3)))));
        require(IUsdt(USDT).balanceOf(buyer) == before3, "cancel did not return the full amount");
        console2.log("4 cancel ok");

        // 5. the deadline and the settle window pass: anyone refunds, full amount back.
        bytes32 offer4 = keccak256("offer-4");
        ICountersignedEscrow.Countersignature memory cs4 = _countersign(offer4, PRICE, uint64(block.timestamp + 60), 4);
        uint256 before4 = IUsdt(USDT).balanceOf(buyer);
        vm.prank(relayer);
        bytes32 job4 = escrow.fund(offer4, cs4, "");
        vm.warp(block.timestamp + 61 + escrow.DISPUTE_WINDOW());
        vm.prank(makeAddr("stranger"));
        escrow.refund(job4);
        require(IUsdt(USDT).balanceOf(buyer) == before4, "refund did not return the full amount");
        console2.log("5 refund ok");

        console2.log("all checks passed against TetherTokenV2 on chain", block.chainid);
    }

    function _buyUsdt(address to, uint256 wbt) internal {
        vm.deal(to, wbt);
        vm.prank(to);
        IRouter(ROUTER).exactInputSingle{value: wbt}(
            IRouter.ExactInputSingleParams({
                tokenIn: WWBT,
                tokenOut: USDT,
                fee: 3000,
                recipient: to,
                amountIn: wbt,
                amountOutMinimum: 1,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _countersign(bytes32 offerHash, uint256 amount, uint64 deadline, uint256 salt)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = seller;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(offerHash, buyer, seller, amount, deadline, salt, 0, 0);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IUsdt(USDT).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(RECEIVE_TYPEHASH, buyer, address(escrow), amount, cs.validAfter, cs.validBefore, jobId)
                )
            )
        );
        (cs.v, cs.r, cs.s) = vm.sign(buyerKey, digest);
    }

    function _escrowDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
