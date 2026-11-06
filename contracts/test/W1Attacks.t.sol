// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev cs-w1 adversarial tests against CountersignedEscrow. A failing test here is a blocker.
contract W1AttacksTest is Test {
    MockEIP3009 token;
    CountersignedEscrow escrow;
    address treasury = makeAddr("treasury");
    address buyer;
    uint256 buyerKey;
    address seller;
    uint256 sellerKey;
    bytes32 constant OFFER = keccak256("offer");
    bytes32 constant SLIP = keccak256("slip");
    uint256 constant PRICE = 1_500_000;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, 100);
        token.mint(buyer, 100_000_000);
    }

    function _cs(CountersignedEscrow e, uint64 deadline, uint256 salt)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = seller;
        cs.amount = PRICE;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = e.jobIdFor(OFFER, buyer, seller, PRICE, deadline, salt);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        buyer,
                        address(e),
                        PRICE,
                        cs.validAfter,
                        cs.validBefore,
                        jobId
                    )
                )
            )
        );
        (cs.v, cs.r, cs.s) = vm.sign(buyerKey, digest);
    }

    function _sig(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _release(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP)));
    }

    // Cross-escrow / cross-chain domain separation: a countersignature for escrow A is dead on escrow B.
    function test_countersignature_does_not_fund_a_second_escrow() public {
        CountersignedEscrow other = new CountersignedEscrow(address(token), treasury, 100);
        ICountersignedEscrow.Countersignature memory cs = _cs(escrow, uint64(block.timestamp + 300), 1);
        vm.expectRevert();
        other.fund(OFFER, cs);
    }

    // A release signature for escrow A must not release the same jobId on another deployment.
    function test_release_signature_is_not_portable_across_chains() public {
        ICountersignedEscrow.Countersignature memory cs = _cs(escrow, uint64(block.timestamp + 300), 2);
        bytes32 jobId = escrow.fund(OFFER, cs);
        bytes memory sig = _release(jobId);
        vm.chainId(999);
        vm.expectRevert();
        escrow.release(jobId, SLIP, sig);
    }

    // High-s (malleated) release signature is refused.
    function test_malleated_release_signature_is_refused() public {
        ICountersignedEscrow.Countersignature memory cs = _cs(escrow, uint64(block.timestamp + 300), 3);
        bytes32 jobId = escrow.fund(OFFER, cs);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", escrow.domainSeparator(), keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerKey, digest);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 s2 = bytes32(n - uint256(s));
        uint8 v2 = v == 27 ? 28 : 27;
        vm.expectRevert();
        escrow.release(jobId, SLIP, abi.encodePacked(r, s2, v2));
    }

    // Malleated buyer signature must not fund.
    function test_malleated_buyer_signature_is_refused() public {
        ICountersignedEscrow.Countersignature memory cs = _cs(escrow, uint64(block.timestamp + 300), 4);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        cs.s = bytes32(n - uint256(cs.s));
        cs.v = cs.v == 27 ? 28 : 27;
        vm.expectRevert();
        escrow.fund(OFFER, cs);
    }

    // Deadline edge: at t == deadline release works and refund does not; at deadline+1 the reverse.
    function test_deadline_edge_release_wins_at_deadline() public {
        uint64 dl = uint64(block.timestamp + 300);
        bytes32 jobId = escrow.fund(OFFER, _cs(escrow, dl, 5));
        vm.warp(dl);
        vm.expectRevert();
        escrow.refund(jobId);
        escrow.release(jobId, SLIP, _release(jobId));
        assertEq(token.balanceOf(seller), PRICE - PRICE / 100);
    }

    function test_deadline_edge_refund_wins_after_deadline() public {
        uint64 dl = uint64(block.timestamp + 300);
        bytes32 jobId = escrow.fund(OFFER, _cs(escrow, dl, 6));
        vm.warp(dl + 1);
        bytes memory sig = _release(jobId);
        vm.expectRevert();
        escrow.release(jobId, SLIP, sig);
        escrow.refund(jobId);
        assertEq(token.balanceOf(buyer), 100_000_000);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // A refunded job cannot be re-funded with the same countersignature (token nonce burned too).
    function test_refunded_job_cannot_be_funded_again() public {
        uint64 dl = uint64(block.timestamp + 300);
        ICountersignedEscrow.Countersignature memory cs = _cs(escrow, dl, 7);
        bytes32 jobId = escrow.fund(OFFER, cs);
        vm.warp(dl + 1);
        escrow.refund(jobId);
        cs.deadline = dl; // unchanged
        vm.expectRevert();
        escrow.fund(OFFER, cs);
    }

    // Cancel, then release must fail; release, then cancel must fail; no double exit across paths.
    function test_no_exit_after_exit_across_paths() public {
        uint64 dl = uint64(block.timestamp + 300);
        bytes32 jobId = escrow.fund(OFFER, _cs(escrow, dl, 8));
        bytes memory rel = _release(jobId);
        vm.prank(seller);
        escrow.cancel(jobId, "");
        vm.expectRevert();
        escrow.release(jobId, SLIP, rel);
        vm.warp(dl + 1);
        vm.expectRevert();
        escrow.refund(jobId);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    // A release signature for one slip cannot release another.
    function test_release_signature_binds_the_slip() public {
        bytes32 jobId = escrow.fund(OFFER, _cs(escrow, uint64(block.timestamp + 300), 9));
        bytes memory sig = _release(jobId);
        vm.expectRevert();
        escrow.release(jobId, keccak256("other slip"), sig);
    }

    // Escrow never holds more or less than the sum of open jobs; funds conserved through release.
    function test_conservation_through_release() public {
        bytes32 jobId = escrow.fund(OFFER, _cs(escrow, uint64(block.timestamp + 300), 10));
        escrow.release(jobId, SLIP, _release(jobId));
        assertEq(
            token.balanceOf(buyer) + token.balanceOf(seller) + token.balanceOf(treasury) + token.balanceOf(address(escrow)),
            100_000_000
        );
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}
