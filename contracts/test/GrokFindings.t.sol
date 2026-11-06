// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev Signing helpers shared with the audit tests (copied from AuditFixes.t.sol).
abstract contract GrokEscrowSigning is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;

    function _authorization(uint256 key, address from, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(escrow), value, 0, validBefore, nonce
                    )
                )
            )
        );
        return vm.sign(key, digest);
    }

    function _countersignBy(
        uint256 key,
        bytes32 offerHash,
        address payee,
        uint256 amount,
        uint64 deadline,
        uint256 salt,
        uint256 bond,
        uint64 window
    ) internal view returns (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) {
        cs.buyer = vm.addr(key);
        cs.payee = payee;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.bond = bond;
        cs.reviewWindow = window;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 1 days;
        jobId = escrow.jobIdFor(offerHash, cs.buyer, payee, amount, deadline, salt, bond, window);
        (cs.v, cs.r, cs.s) = _authorization(key, cs.buyer, amount, cs.validBefore, jobId);
    }

    function _depositFor(uint256 key, uint256 amount, bytes32 salt) internal {
        address payee = vm.addr(key);
        bytes32 nonce = keccak256(abi.encode(escrow.BOND_DEPOSIT_TYPEHASH(), payee, amount, salt));
        uint256 validBefore = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _authorization(key, payee, amount, validBefore, nonce);
        escrow.depositBond(payee, amount, 0, validBefore, salt, v, r, s);
    }

    function _sig(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}

/// @dev The four findings from the independent audit of escrow v2 (06 Nov 2026), written
///      against the option-(d) contract so each one fails before its fix.
contract GrokFindingsTest is GrokEscrowSigning {
    address internal treasury = makeAddr("treasury");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("offer: a bonded, reviewed skill");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000;
    uint256 internal constant BOND = 500_000;
    uint16 internal constant TOLL_BPS = 100;
    uint64 internal constant WINDOW = 3600;
    uint64 internal constant DEADLINE_IN = 300;
    uint64 internal constant DISPUTE_WINDOW = 600;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, TOLL_BPS, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(seller, 100_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _deposit(uint256 amount) internal {
        _depositFor(sellerKey, amount, keccak256(abi.encode("deposit", amount, block.timestamp)));
    }

    function _publish(uint256 bond, uint64 window) internal {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, bond, window, 0);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + DEADLINE_IN);
    }

    function _cs(uint256 salt, uint256 bond, uint64 window)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId)
    {
        return _countersignBy(buyerKey, OFFER, seller, PRICE, _deadline(), salt, bond, window);
    }

    function _releaseSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP)));
    }

    function _disputeSig(bytes32 jobId, uint8 signedStatus) internal view returns (bytes memory) {
        return _sig(buyerKey, keccak256(abi.encode(escrow.DISPUTE_TYPEHASH(), jobId, signedStatus)));
    }

    function _lockSig(uint256 payeeKey, bytes32 jobId) internal view returns (bytes memory) {
        return _sig(payeeKey, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId)));
    }

    function _status(bytes32 jobId) internal view returns (uint8) {
        return uint8(escrow.jobOf(jobId).status);
    }

    // ------------------------------------------------------------------ H1

    function test_H1_a_bond_moves_only_with_the_payee_lock() public {
        _deposit(BOND);
        _publish(BOND, 0);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, BOND, 0);

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        vm.prank(arbiter);
        escrow.fund(OFFER, cs, "");

        assertEq(escrow.bondOf(seller), BOND, "the free bond is untouched");

        // With the payee's Lock, a stranger funds and the bond locks.
        vm.prank(stranger);
        escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId));

        assertEq(escrow.bondOf(seller), 0, "the bond left the free balance");
        assertEq(escrow.bondOfJob(jobId), BOND, "the bond is locked to the job");
    }

    // ------------------------------------------------------------------ H2

    function test_H2_a_delivered_job_cannot_be_cancelled() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, BOND, WINDOW);
        vm.prank(arbiter);
        escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId));

        escrow.release(jobId, SLIP, _releaseSig(jobId));
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Delivered));

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotOpen.selector, jobId));
        vm.prank(seller);
        escrow.cancel(jobId, "");
    }

    // ------------------------------------------------------------------ M

    function test_M_a_funded_time_dispute_signature_cannot_forfeit_after_delivery() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, BOND, WINDOW);
        vm.prank(arbiter);
        escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId));

        bytes memory fundedSig = _disputeSig(jobId, uint8(ICountersignedEscrow.Status.Funded));
        escrow.release(jobId, SLIP, _releaseSig(jobId));
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Delivered));

        vm.expectRevert(
            abi.encodeWithSelector(
                ICountersignedEscrow.StatusMismatch.selector, jobId, uint8(ICountersignedEscrow.Status.Funded)
            )
        );
        vm.prank(stranger);
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Funded), fundedSig);
    }

    // ------------------------------------------------------------------ L

    function test_L_a_registered_bonded_offer_cannot_be_funded_with_bond_zero() public {
        _deposit(BOND);
        _publish(BOND, 0);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, 0, 0);

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        vm.prank(stranger);
        escrow.fund(OFFER, cs, "");
    }

    // ------------------------------------------------------------------ W

    function test_W_a_bond_needs_a_review_window() public {
        vm.prank(seller);
        vm.expectRevert(ICountersignedEscrow.BondNeedsWindow.selector);
        escrow.setTerms(OFFER, PRICE, BOND, 0, 0);
    }
}
