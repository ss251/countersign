// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev Escrow v2 delivery review (#98, docs/spec/escrow.md "Escrow v2"): with a review window,
///      release records the delivery and payment waits for the buyer's accept, the window's end,
///      or the buyer's dispute. Each test checks where the money and the bond end up.
contract AcceptanceTest is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;

    address internal treasury = makeAddr("treasury");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger;
    uint256 internal strangerKey;
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("offer: a reviewed skill");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000; // 1.50 USDC
    uint256 internal constant BOND = 500_000; // 0.50 USDC
    uint16 internal constant TOLL_BPS = 100; // 1%
    uint64 internal constant WINDOW = 3600; // one hour of review
    uint64 internal constant DEADLINE_IN = 300;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        (stranger, strangerKey) = makeAddrAndKey("stranger");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, TOLL_BPS, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(seller, 10_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _countersign(uint256 bond, uint64 window)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = seller;
        cs.amount = PRICE;
        cs.deadline = uint64(block.timestamp + DEADLINE_IN);
        cs.salt = 1;
        cs.bond = bond;
        cs.reviewWindow = window;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, bond, window);
        (cs.v, cs.r, cs.s) = _authorizationSig(buyerKey, buyer, PRICE, cs.validAfter, cs.validBefore, jobId);
    }

    function _authorizationSig(
        uint256 key,
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        from,
                        address(escrow),
                        value,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
        return vm.sign(key, digest);
    }

    function _sign712(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _releaseSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sign712(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP)));
    }

    function _acceptSig(uint256 key, bytes32 jobId) internal view returns (bytes memory) {
        return _sign712(key, keccak256(abi.encode(escrow.ACCEPT_TYPEHASH(), jobId, SLIP)));
    }

    function _disputeSig(uint256 key, bytes32 jobId, uint8 status) internal view returns (bytes memory) {
        return _sign712(key, keccak256(abi.encode(escrow.DISPUTE_TYPEHASH(), jobId, status)));
    }

    function _lockSig(uint256 payeeKey, bytes32 jobId) internal view returns (bytes memory) {
        return _sign712(payeeKey, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId)));
    }

    /// The seller posts the bond and registers the offer's terms, as it does at publish.
    function _sellerPublishes(uint64 window) internal {
        bytes32 salt = keccak256("bond deposit");
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = keccak256(abi.encode(escrow.BOND_DEPOSIT_TYPEHASH(), seller, BOND, salt));
        (uint8 v, bytes32 r, bytes32 s) = _authorizationSig(sellerKey, seller, BOND, 0, validBefore, nonce);
        escrow.depositBond(seller, BOND, 0, validBefore, salt, v, r, s);
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, BOND, window, 0);
    }

    /// The buyer countersigns the offer's bond and window, and the arbiter funds the bonded job.
    function _fund() internal returns (bytes32 jobId) {
        _sellerPublishes(WINDOW);
        ICountersignedEscrow.Countersignature memory cs = _countersign(BOND, WINDOW);
        jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND, WINDOW);
        vm.prank(arbiter);
        jobId = escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId));
    }

    /// Fund, then deliver: the job is Delivered and the review window starts now.
    function _deliver() internal returns (bytes32 jobId, uint64 endsAt) {
        jobId = _fund();
        endsAt = uint64(block.timestamp) + WINDOW;
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Delivered(jobId, SLIP, uint64(block.timestamp), endsAt);
        escrow.release(jobId, SLIP, _releaseSig(jobId));
        _assertStatus(jobId, ICountersignedEscrow.Status.Delivered);
    }

    function _assertStatus(bytes32 jobId, ICountersignedEscrow.Status status) internal view {
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(status));
    }

    function _toll() internal pure returns (uint256) {
        return PRICE * TOLL_BPS / 10_000;
    }

    // ------------------------------------------------------------------ the review window holds the money

    function test_release_with_a_window_holds_the_money_and_records_the_review() public {
        uint256 sellerBefore = token.balanceOf(seller);
        (bytes32 jobId, uint64 endsAt) = _deliver();

        assertEq(token.balanceOf(seller), sellerBefore - BOND, "nothing paid yet; only the bond left the wallet");
        assertEq(token.balanceOf(address(escrow)), PRICE + BOND);
        assertEq(escrow.bondOfJob(jobId), BOND);
        (uint64 window, uint64 deliveredAt, uint64 reviewEndsAt) = escrow.reviewOf(jobId);
        assertEq(window, WINDOW);
        assertEq(deliveredAt, uint64(block.timestamp));
        assertEq(reviewEndsAt, endsAt);
    }

    // ------------------------------------------------------------------ 1. the buyer accepts early

    function test_1_buyer_accepts_early_the_seller_is_paid_and_the_bond_returns() public {
        (bytes32 jobId,) = _deliver();
        uint256 sellerBefore = token.balanceOf(seller);
        vm.warp(block.timestamp + 60);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Accepted(jobId, buyer);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Released(jobId, SLIP, seller, PRICE - _toll(), _toll());
        // Relayed by a stranger holding the buyer's Accept signature, as the hub does.
        vm.prank(stranger);
        escrow.accept(jobId, _acceptSig(buyerKey, jobId));

        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - _toll(), "seller paid");
        assertEq(escrow.tollAccrued(), _toll(), "the toll accrues for the treasury");
        assertEq(escrow.bondOf(seller), BOND, "bond back in the free balance");
        assertEq(escrow.bondOfJob(jobId), 0);
        _assertStatus(jobId, ICountersignedEscrow.Status.Released);
    }

    function test_1b_the_buyer_can_accept_by_calling_it_directly() public {
        (bytes32 jobId,) = _deliver();
        vm.prank(buyer);
        escrow.accept(jobId, "");
        _assertStatus(jobId, ICountersignedEscrow.Status.Released);
    }

    // ------------------------------------------------------------------ 2. the buyer disputes inside the window

    function test_2_buyer_disputes_inside_the_window_is_refunded_and_takes_the_bond() public {
        (bytes32 jobId, uint64 endsAt) = _deliver();
        uint256 buyerBefore = token.balanceOf(buyer);
        uint256 sellerBefore = token.balanceOf(seller);
        bytes memory sig = _disputeSig(buyerKey, jobId, uint8(ICountersignedEscrow.Status.Delivered));
        vm.warp(endsAt - 1); // the last second of the window, and past the delivery deadline

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Disputed(jobId, buyer);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, false);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondForfeited(jobId, buyer, BOND);
        vm.prank(stranger);
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), sig);

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND, "buyer refunded at once, plus the bond (D16)");
        assertEq(token.balanceOf(seller), sellerBefore, "seller not paid");
        assertEq(escrow.tollAccrued(), 0, "no toll on a dispute");
        assertEq(escrow.bondOf(seller), 0, "junk costs the seller the bond");
        _assertStatus(jobId, ICountersignedEscrow.Status.Disputed);
    }

    function test_2b_a_funded_job_can_be_disputed_before_delivery_up_to_the_deadline() public {
        bytes32 jobId = _fund();
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.warp(escrow.jobOf(jobId).deadline);
        vm.prank(buyer);
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Funded), "");
        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(escrow.bondOf(seller), BOND, "before delivery the bond goes back to the seller");
        _assertStatus(jobId, ICountersignedEscrow.Status.Disputed);
    }

    // ------------------------------------------------------------------ 3. nobody acts

    function test_3_release_after_window_fails_one_second_early_then_pays() public {
        (bytes32 jobId, uint64 endsAt) = _deliver();
        uint256 sellerBefore = token.balanceOf(seller);

        // endsAt is the window's last second (L3: until T is now <= T), so the release opens after it.
        vm.warp(endsAt);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.ReviewOpen.selector, jobId, endsAt));
        vm.prank(stranger);
        escrow.releaseAfterWindow(jobId);

        vm.warp(uint256(endsAt) + 1);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.WindowElapsed(jobId);
        vm.prank(stranger);
        escrow.releaseAfterWindow(jobId);

        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - _toll(), "an absent buyer cannot starve the seller");
        assertEq(escrow.bondOf(seller), BOND);
        _assertStatus(jobId, ICountersignedEscrow.Status.Released);
    }

    function test_3b_a_delivered_job_is_never_refunded_by_the_deadline() public {
        (bytes32 jobId,) = _deliver();
        vm.warp(uint256(escrow.jobOf(jobId).deadline) + escrow.DISPUTE_WINDOW() + 1);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.refund(jobId);
    }

    // ------------------------------------------------------------------ 4. the seller never delivers

    function test_4_seller_never_delivers_the_refund_after_settleBy_pays_amount_plus_bond() public {
        bytes32 jobId = _fund();
        uint256 buyerBefore = token.balanceOf(buyer);
        uint256 settleBy = uint256(escrow.jobOf(jobId).deadline) + escrow.DISPUTE_WINDOW();

        vm.warp(uint256(escrow.jobOf(jobId).deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowOpen.selector, jobId, settleBy));
        escrow.refund(jobId);

        vm.warp(settleBy + 1);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND);
        assertEq(escrow.bondOf(seller), 0, "a silent seller forfeits the bond (C2)");
        _assertStatus(jobId, ICountersignedEscrow.Status.Refunded);
    }

    // ------------------------------------------------------------------ 5. too late to dispute

    function test_5_a_dispute_after_the_window_has_closed_reverts() public {
        (bytes32 jobId, uint64 endsAt) = _deliver();
        vm.warp(uint256(endsAt) + 1);
        bytes memory sig = _disputeSig(buyerKey, jobId, uint8(ICountersignedEscrow.Status.Delivered));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.ReviewClosed.selector, jobId, endsAt));
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), sig);
        _assertStatus(jobId, ICountersignedEscrow.Status.Delivered);
    }

    function test_5b_a_funded_job_cannot_be_disputed_after_its_deadline() public {
        bytes32 jobId = _fund();
        vm.warp(escrow.jobOf(jobId).deadline + 1);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Funded), "");
    }

    // ------------------------------------------------------------------ 6. only the buyer decides

    function test_6_a_third_party_cannot_dispute_without_the_buyers_signature() public {
        (bytes32 jobId,) = _deliver();
        // Signatures are made before expectRevert: making one calls the escrow's view functions.
        bytes memory byStranger = _disputeSig(strangerKey, jobId, uint8(ICountersignedEscrow.Status.Delivered));
        bytes memory bySeller = _disputeSig(sellerKey, jobId, uint8(ICountersignedEscrow.Status.Delivered));

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotBuyer.selector, jobId));
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), "");
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotBuyer.selector, jobId));
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), byStranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotBuyer.selector, jobId));
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), bySeller);
        vm.stopPrank();

        _assertStatus(jobId, ICountersignedEscrow.Status.Delivered);
    }

    function test_6b_nor_accept_without_it_and_an_accept_signature_is_not_a_dispute() public {
        (bytes32 jobId,) = _deliver();
        bytes memory strangersAccept = _acceptSig(strangerKey, jobId);
        bytes memory buyersAccept = _acceptSig(buyerKey, jobId);

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotBuyer.selector, jobId));
        escrow.accept(jobId, strangersAccept);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotBuyer.selector, jobId));
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), buyersAccept);
        vm.stopPrank();
        _assertStatus(jobId, ICountersignedEscrow.Status.Delivered);
    }

    // ------------------------------------------------------------------ v1 behaviour is unchanged

    function test_a_window_of_zero_releases_at_once_as_in_v1() public {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, 0, 0, 0);
        ICountersignedEscrow.Countersignature memory cs = _countersign(0, 0);
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, 0, 0);
        vm.prank(arbiter);
        jobId = escrow.fund(OFFER, cs, "");

        uint256 sellerBefore = token.balanceOf(seller);
        escrow.release(jobId, SLIP, _releaseSig(jobId));
        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - _toll());
        _assertStatus(jobId, ICountersignedEscrow.Status.Released);
    }

    function test_accept_and_release_after_window_refuse_a_job_that_is_not_delivered() public {
        bytes32 jobId = _fund();
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotDelivered.selector, jobId));
        escrow.accept(jobId, "");
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotDelivered.selector, jobId));
        escrow.releaseAfterWindow(jobId);
    }
}
