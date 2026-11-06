// Copy into contracts/test/ of the escrow v2.1 branch to run: forge test --match-path contracts/test/W1V21.t.sol
// (kept outside contracts/test on cs/w1, whose contract still has the older interface).
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev cs-w1's adversarial suite for escrow v2.1: Grok's two highs, its medium and its low, written
///      against the interface decided on #164 (fund with the payee's Lock(jobId), cancel only while
///      Funded, Dispute(jobId,status), the terms check whenever a price is registered). A failing test
///      here is a blocker.
contract W1V21Test is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal arbiter;
    uint256 internal arbiterKey;
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("w1: a bonded, reviewed offer");
    bytes32 internal constant OTHER_OFFER = keccak256("w1: an offer nobody registered");
    bytes32 internal constant SLIP = keccak256("w1: any slip at all");
    uint256 internal constant PRICE = 1_500_000;
    uint256 internal constant BOND = 500_000;
    uint64 internal constant WINDOW = 3600;
    uint64 internal constant MIN_DURATION = 120;
    uint8 internal constant FUNDED = 1;
    uint8 internal constant DELIVERED = 5;

    function setUp() public {
        vm.warp(1_762_400_000);
        (arbiter, arbiterKey) = makeAddrAndKey("arbiter");
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, 100, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(seller, 100_000_000);
    }

    // ------------------------------------------------------------------ helpers

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

    function _countersign(bytes32 offerHash, uint256 amount, uint256 salt, uint256 bond, uint64 window)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId)
    {
        cs.buyer = buyer;
        cs.payee = seller;
        cs.amount = amount;
        cs.deadline = uint64(block.timestamp + MIN_DURATION);
        cs.salt = salt;
        cs.bond = bond;
        cs.reviewWindow = window;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 1 days;
        jobId = escrow.jobIdFor(offerHash, buyer, seller, amount, cs.deadline, salt, bond, window);
        (cs.v, cs.r, cs.s) = _authorization(buyerKey, buyer, amount, cs.validBefore, jobId);
    }

    function _deposit(uint256 amount) internal {
        bytes32 salt = keccak256(abi.encode("w1 deposit", amount, block.timestamp));
        bytes32 nonce = keccak256(abi.encode(escrow.BOND_DEPOSIT_TYPEHASH(), seller, amount, salt));
        uint256 validBefore = block.timestamp + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _authorization(sellerKey, seller, amount, validBefore, nonce);
        escrow.depositBond(seller, amount, 0, validBefore, salt, v, r, s);
    }

    function _publish(uint256 bond, uint64 window) internal {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, bond, window, MIN_DURATION);
    }

    function _sigOn(CountersignedEscrow on, uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", on.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sig(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        return _sigOn(escrow, key, structHash);
    }

    /// The payee's Lock(jobId, funder): only `funder`, as msg.sender, may open the bonded job with it.
    function _lock(uint256 key, bytes32 jobId, address funder) internal view returns (bytes memory) {
        return _sig(key, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId, funder)));
    }

    function _releaseSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP)));
    }

    function _cancelSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), jobId)));
    }

    function _disputeSig(bytes32 jobId, uint8 status) internal view returns (bytes memory) {
        return _sig(buyerKey, keccak256(abi.encode(escrow.DISPUTE_TYPEHASH(), jobId, status)));
    }

    /// The seller deposits and registers (BOND, window), the buyer countersigns, the seller locks, a relayer funds.
    function _fundBonded(uint256 salt, uint64 window) internal returns (bytes32 jobId) {
        _deposit(BOND);
        _publish(BOND, window);
        ICountersignedEscrow.Countersignature memory cs;
        (cs, jobId) = _countersign(OFFER, PRICE, salt, BOND, window);
        bytes memory lock = _lock(sellerKey, jobId, relayer);
        vm.prank(relayer);
        escrow.fund(OFFER, cs, lock);
    }

    function _status(bytes32 jobId) internal view returns (uint8) {
        return uint8(escrow.jobOf(jobId).status);
    }

    // ------------------------------------------------------------------ the strings

    function test_W1_v21_the_typehashes_are_the_decided_strings() public view {
        assertEq(escrow.LOCK_TYPEHASH(), keccak256("Lock(bytes32 jobId,address funder)"));
        assertEq(escrow.DISPUTE_TYPEHASH(), keccak256("Dispute(bytes32 jobId,uint8 status)"));
    }

    // ------------------------------------------------------------------ High 1: no bond moves without the payee's Lock

    function test_W1_H1_no_lock_or_a_wrong_lock_cannot_fund_a_bonded_job() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _countersign(OFFER, PRICE, 1, BOND, WINDOW);
        uint256 freeBond = escrow.bondOf(seller);
        uint256 buyerWallet = token.balanceOf(buyer);

        CountersignedEscrow twin = new CountersignedEscrow(address(token), treasury, 100, arbiter);
        bytes[6] memory wrong = [
            bytes(""),
            _lock(arbiterKey, jobId, arbiter), // the arbiter is not the payee
            _lock(buyerKey, jobId, arbiter), // nor is the buyer
            _lock(sellerKey, keccak256("w1: another job"), arbiter), // the payee's lock for another job
            _sigOn(twin, sellerKey, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId, arbiter))), // another escrow
            _lock(sellerKey, jobId, relayer) // the payee's lock, but naming another funder
        ];
        for (uint256 i; i < wrong.length; ++i) {
            vm.prank(arbiter);
            vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
            escrow.fund(OFFER, cs, wrong[i]);
        }
        assertEq(escrow.bondOf(seller), freeBond, "a bond moved without the payee's lock");
        assertEq(token.balanceOf(buyer), buyerWallet, "the buyer paid into a job the payee never locked");
    }

    function test_W1_H1_the_arbiter_and_a_buyer_cannot_force_a_default_without_the_payee() public {
        // Grok's trace: registered terms, the shortest deadline, the arbiter funds, then failDelivery.
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _countersign(OFFER, PRICE, 2, BOND, WINDOW);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, "");
        vm.prank(arbiter);
        vm.expectRevert();
        escrow.failDelivery(jobId);
        assertEq(escrow.bondOf(seller), BOND, "the seller's bond left without its consent");
    }

    function test_W1_H1_only_the_named_funder_opens_exactly_the_signed_job_once() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _countersign(OFFER, PRICE, 3, BOND, WINDOW);
        bytes memory lock = _lock(sellerKey, jobId, relayer);
        // Anyone but the named funder is refused with the very same lock: a stranger, the buyer, the arbiter.
        address[3] memory others = [makeAddr("w1 stranger"), buyer, arbiter];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
            escrow.fund(OFFER, cs, lock);
        }
        vm.prank(relayer);
        assertEq(escrow.fund(OFFER, cs, lock), jobId);
        assertEq(escrow.bondOfJob(jobId), BOND);
        assertEq(escrow.bondOf(seller), 0);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fund(OFFER, cs, lock);
    }

    function test_W1_H1_an_unbonded_job_ignores_the_lock() public {
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _countersign(OTHER_OFFER, PRICE, 4, 0, 0);
        vm.prank(relayer);
        assertEq(escrow.fund(OTHER_OFFER, cs, hex"deadbeef"), jobId);
        assertEq(_status(jobId), FUNDED);
    }

    // ------------------------------------------------------------------ High 2: no cancel once delivered

    function test_W1_H2_release_then_cancel_reverts_and_the_dispute_forfeits_the_bond() public {
        bytes32 jobId = _fundBonded(5, WINDOW);
        bytes memory releaseSig = _releaseSig(jobId);
        bytes memory cancelSig = _cancelSig(jobId);
        bytes memory disputeSig = _disputeSig(jobId, DELIVERED);
        vm.prank(relayer);
        escrow.release(jobId, SLIP, releaseSig);
        assertEq(_status(jobId), DELIVERED);

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotOpen.selector, jobId));
        escrow.cancel(jobId, cancelSig);

        uint256 before = token.balanceOf(buyer);
        vm.prank(relayer);
        escrow.dispute(jobId, DELIVERED, disputeSig);
        assertEq(token.balanceOf(buyer), before + PRICE + BOND, "the buyer did not get the amount and the bond");
    }

    function test_W1_H2_a_late_release_then_cancel_reverts() public {
        bytes32 jobId = _fundBonded(6, WINDOW);
        bytes memory releaseSig = _releaseSig(jobId);
        bytes memory cancelSig = _cancelSig(jobId);
        vm.warp(uint256(escrow.jobOf(jobId).deadline) + 1);
        vm.prank(relayer);
        escrow.release(jobId, SLIP, releaseSig); // still inside settleBy
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotOpen.selector, jobId));
        escrow.cancel(jobId, cancelSig);
        assertEq(escrow.bondOfJob(jobId), BOND, "the late seller took its bond back");
    }

    function test_W1_H2_an_honest_late_release_keeps_the_bond_once_the_window_passes() public {
        // H1's property under "bond implies window": a release that lands after the deadline but by
        // settleBy is Delivered, and with no dispute the seller gets the payment and its whole bond back.
        bytes32 jobId = _fundBonded(12, WINDOW);
        uint256 settleBy = uint256(escrow.jobOf(jobId).deadline) + 600;
        bytes memory releaseSig = _releaseSig(jobId);
        vm.warp(settleBy);
        vm.prank(relayer);
        escrow.release(jobId, SLIP, releaseSig);
        assertEq(_status(jobId), DELIVERED);
        uint256 sellerBefore = token.balanceOf(seller);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.releaseAfterWindow(jobId);
        assertEq(escrow.bondOf(seller), BOND, "an honest late release lost the bond");
        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - escrow.tollOf(PRICE), "the seller was not paid");
    }

    // ------------------------------------------------------------------ bond implies window (the captain's option (a))

    function test_W1_a_bond_needs_a_review_window() public {
        vm.prank(seller);
        vm.expectRevert(ICountersignedEscrow.BondNeedsWindow.selector);
        escrow.setTerms(OFFER, PRICE, BOND, 0, MIN_DURATION);
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, 0, 0, MIN_DURATION); // no bond needs no window
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, BOND, WINDOW, MIN_DURATION);
    }

    function test_W1_bonded_terms_need_the_minimum_duration() public {
        uint64 floor = escrow.MIN_BONDED_DURATION();
        vm.prank(seller);
        vm.expectRevert(ICountersignedEscrow.BondNeedsDuration.selector);
        escrow.setTerms(OFFER, PRICE, BOND, WINDOW, floor - 1);
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, BOND, WINDOW, floor);
        (,,, uint64 minDuration) = escrow.termsOf(seller, OFFER);
        assertEq(minDuration, floor);
    }

    // ------------------------------------------------------------------ Medium: one dispute signature, one outcome

    function test_W1_M_a_dispute_signed_while_funded_cannot_run_after_delivery() public {
        bytes32 jobId = _fundBonded(7, WINDOW);
        bytes memory signedFunded = _disputeSig(jobId, FUNDED);
        bytes memory releaseSig = _releaseSig(jobId);
        vm.prank(relayer);
        escrow.release(jobId, SLIP, releaseSig);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.StatusMismatch.selector, jobId, FUNDED));
        escrow.dispute(jobId, FUNDED, signedFunded);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.dispute(jobId, DELIVERED, signedFunded);
        assertEq(_status(jobId), DELIVERED);
        assertEq(escrow.bondOfJob(jobId), BOND);
    }

    function test_W1_M_a_dispute_signed_for_delivery_cannot_run_while_funded() public {
        bytes32 jobId = _fundBonded(8, WINDOW);
        bytes memory signedDelivered = _disputeSig(jobId, DELIVERED);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.StatusMismatch.selector, jobId, DELIVERED));
        escrow.dispute(jobId, DELIVERED, signedDelivered);
        assertEq(_status(jobId), FUNDED);
    }

    function test_W1_M_a_funded_dispute_returns_the_bond_to_the_seller() public {
        bytes32 jobId = _fundBonded(9, WINDOW);
        bytes memory signedFunded = _disputeSig(jobId, FUNDED);
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.prank(relayer);
        escrow.dispute(jobId, FUNDED, signedFunded);
        assertEq(token.balanceOf(buyer), buyerBefore + PRICE);
        assertEq(escrow.bondOf(seller), BOND);
    }

    // ------------------------------------------------------------------ Low: a registered offer funds only on its terms

    function test_W1_L_a_registered_offer_cannot_be_funded_off_terms_without_a_bond() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cheap,) = _countersign(OFFER, 1, 10, 0, 0);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fund(OFFER, cheap, "");
        (ICountersignedEscrow.Countersignature memory noBond,) = _countersign(OFFER, PRICE, 11, 0, 0);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fund(OFFER, noBond, "");
        assertEq(escrow.bondOf(seller), BOND);
    }
}
