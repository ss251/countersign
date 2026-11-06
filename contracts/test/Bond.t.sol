// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev The seller bond: deposited free, locked at funding against the payee's registered terms,
///      returned on release and cancel, and paid to the buyer on failDelivery and on a default (C2).
contract BondTest is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;

    address internal treasury = makeAddr("treasury");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("offer: a bonded skill");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000; // 1.50 USDC
    uint256 internal constant BOND = 500_000; // 0.50 USDC
    uint16 internal constant TOLL_BPS = 100; // 1%
    uint64 internal constant REVIEW_WINDOW = 60;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, TOLL_BPS, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(seller, 10_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _countersign(bytes32 offerHash, address payee, uint256 amount, uint64 deadline, uint256 salt, uint256 bond)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = payee;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.bond = bond;
        cs.reviewWindow = REVIEW_WINDOW;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(offerHash, buyer, payee, amount, deadline, salt, bond, REVIEW_WINDOW);
        (cs.v, cs.r, cs.s) = _authorizationSig(
            buyerKey, buyer, address(escrow), amount, cs.validAfter, cs.validBefore, jobId
        );
    }

    function _authorizationSig(
        uint256 key,
        address from,
        address to,
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
                        to,
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

    function _cs(uint256 bond) internal view returns (ICountersignedEscrow.Countersignature memory) {
        return _countersign(OFFER, seller, PRICE, uint64(block.timestamp + 300), 1, bond);
    }

    /// The seller registers the offer's bond, as it does once at publish.
    function _terms(uint256 bond) internal {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, bond, REVIEW_WINDOW, bond == 0 ? 0 : 60);
    }

    function _sign712(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _releaseSig(uint256 key, bytes32 jobId, bytes32 slipHash) internal view returns (bytes memory) {
        return _sign712(key, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, slipHash)));
    }

    function _lockSig(uint256 payeeKey, bytes32 jobId, address funder) internal view returns (bytes memory) {
        return _sign712(payeeKey, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId, funder)));
    }

    /// The first second after settleBy = deadline + DISPUTE_WINDOW (H1).
    function _afterSettle(ICountersignedEscrow.Countersignature memory cs) internal view returns (uint256) {
        return uint256(cs.deadline) + escrow.DISPUTE_WINDOW() + 1;
    }

    function _depositNonce(uint256 amount, bytes32 salt) internal view returns (bytes32) {
        return keccak256(abi.encode(escrow.BOND_DEPOSIT_TYPEHASH(), seller, amount, salt));
    }

    function _deposit(uint256 amount) internal {
        _depositWithSalt(amount, keccak256("bond deposit"));
    }

    function _depositWithSalt(uint256 amount, bytes32 salt) internal {
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = _depositNonce(amount, salt);
        (uint8 v, bytes32 r, bytes32 s) =
            _authorizationSig(sellerKey, seller, address(escrow), amount, validAfter, validBefore, nonce);
        escrow.depositBond(seller, amount, validAfter, validBefore, salt, v, r, s);
    }

    function _fundBonded(uint256 bond)
        internal
        returns (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs)
    {
        _deposit(bond);
        _terms(bond);
        cs = _cs(bond);
        bytes32 expected = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, bond, REVIEW_WINDOW);
        bytes memory lock = _lockSig(sellerKey, expected, arbiter);
        vm.prank(arbiter); // the arbiter funds a bonded job
        jobId = escrow.fund(OFFER, cs, lock);
    }

    // ------------------------------------------------------------------ the four paths

    function test_delivering_seller_gets_paid_and_the_bond_comes_back() public {
        (bytes32 jobId,) = _fundBonded(BOND);
        assertEq(escrow.bondOf(seller), 0, "the bond is locked");
        assertEq(escrow.bondOfJob(jobId), BOND);
        uint256 sellerWallet = token.balanceOf(seller);

        uint256 toll = PRICE * TOLL_BPS / 10_000;
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        vm.stopPrank();
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondReturned(jobId, seller, BOND);
        vm.prank(buyer);
        escrow.accept(jobId, "");

        assertEq(token.balanceOf(seller) - sellerWallet, PRICE - toll);
        assertEq(escrow.bondOf(seller), BOND);
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Released));
    }

    function test_failing_seller_pays_the_buyer_the_amount_and_the_bond() public {
        (bytes32 jobId,) = _fundBonded(BOND);
        uint256 buyerWallet = token.balanceOf(buyer);
        uint256 sellerFreeBefore = escrow.bondOf(seller);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.DeliveryFailed(jobId, buyer, PRICE, BOND);
        vm.prank(arbiter);
        escrow.failDelivery(jobId);

        assertEq(token.balanceOf(buyer) - buyerWallet, PRICE + BOND);
        assertEq(escrow.bondOf(seller), sellerFreeBefore);
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Failed));
    }

    function test_silent_seller_refunds_the_buyer_and_forfeits_the_bond() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _fundBonded(BOND);
        vm.warp(_afterSettle(cs));
        uint256 buyerWallet = token.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondForfeited(jobId, buyer, BOND);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(token.balanceOf(buyer) - buyerWallet, PRICE + BOND);
        assertEq(escrow.bondOf(seller), 0);
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Refunded));
    }

    /// C2: silence is no cheaper than a failed delivery. Both cost the seller exactly the bond.
    function test_a_failing_seller_and_a_silent_one_both_lose_the_bond() public {
        uint256 snapshot = vm.snapshotState();

        (bytes32 failedJob,) = _fundBonded(BOND);
        vm.prank(arbiter);
        escrow.failDelivery(failedJob);
        uint256 failingSeller = token.balanceOf(seller) + escrow.bondOf(seller);
        uint256 failingBuyer = token.balanceOf(buyer);

        vm.revertToState(snapshot);

        (bytes32 silentJob, ICountersignedEscrow.Countersignature memory cs) = _fundBonded(BOND);
        vm.warp(_afterSettle(cs));
        vm.prank(stranger);
        escrow.refund(silentJob);
        uint256 silentSeller = token.balanceOf(seller) + escrow.bondOf(seller);
        uint256 silentBuyer = token.balanceOf(buyer);

        assertEq(silentSeller, failingSeller, "silence saves the seller nothing");
        assertEq(silentBuyer, failingBuyer, "the buyer ends the same either way");
        assertEq(silentBuyer, 100_000_000 + BOND, "and gains exactly the bond");
    }

    function test_payee_cancel_returns_the_bond() public {
        (bytes32 jobId,) = _fundBonded(BOND);

        vm.prank(seller);
        escrow.cancel(jobId, "");

        assertEq(escrow.bondOf(seller), BOND);
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    // ------------------------------------------------------------------ refusals

    function test_fund_bonded_refuses_more_than_the_free_bond() public {
        _deposit(BOND);
        _terms(BOND + 1);
        ICountersignedEscrow.Countersignature memory cs = _cs(BOND + 1);
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND + 1, REVIEW_WINDOW);
        uint256 buyerWallet = token.balanceOf(buyer);
        uint256 escrowWallet = token.balanceOf(address(escrow));

        bytes memory lockSig = _lockSig(sellerKey, jobId, arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.BondMissing.selector, seller, BOND + 1, BOND));
        vm.prank(arbiter);
        escrow.fund(OFFER, cs, lockSig);

        assertEq(token.balanceOf(buyer), buyerWallet);
        assertEq(token.balanceOf(address(escrow)), escrowWallet);
        assertEq(escrow.bondOf(seller), BOND);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.None));
    }

    function test_only_the_arbiter_can_fail_a_delivery() public {
        (bytes32 jobId,) = _fundBonded(BOND);
        vm.prank(stranger);
        vm.expectRevert(ICountersignedEscrow.NotArbiter.selector);
        escrow.failDelivery(jobId);
    }

    function test_fail_delivery_refuses_after_settle_by() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _fundBonded(BOND);
        uint256 settleBy = _afterSettle(cs) - 1;
        vm.warp(settleBy + 1);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowClosed.selector, jobId, settleBy));
        escrow.failDelivery(jobId);
    }

    function test_fail_delivery_refuses_a_released_job() public {
        (bytes32 jobId,) = _fundBonded(BOND);
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        vm.stopPrank();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.failDelivery(jobId);
    }

    function test_fail_delivery_refuses_a_refunded_job() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _fundBonded(BOND);
        vm.warp(_afterSettle(cs));
        escrow.refund(jobId);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.failDelivery(jobId);
    }

    function test_a_locked_bond_cannot_be_withdrawn_but_the_free_bond_can() public {
        uint256 free = 300_000;
        _deposit(BOND + free);
        _terms(BOND);
        ICountersignedEscrow.Countersignature memory cs = _cs(BOND);
        bytes32 expected = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND, REVIEW_WINDOW);
        vm.startPrank(arbiter);
        bytes32 jobId = escrow.fund(OFFER, cs, _lockSig(sellerKey, expected, arbiter));
        vm.stopPrank();
        assertEq(escrow.bondOf(seller), free);
        assertEq(escrow.bondOfJob(jobId), BOND);

        vm.prank(seller);
        escrow.withdrawBond(free);
        assertEq(escrow.bondOf(seller), 0);
        assertEq(escrow.bondOfJob(jobId), BOND);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.BondMissing.selector, seller, 1, 0));
        escrow.withdrawBond(1);
    }

    function test_a_deposit_uses_the_computed_bond_nonce() public {
        bytes32 salt = keccak256("one deposit");
        _depositWithSalt(BOND, salt);

        assertEq(escrow.bondOf(seller), BOND);
        assertTrue(token.authorizationState(seller, _depositNonce(BOND, salt)));
    }

    function test_a_deposit_replayed_with_the_same_salt_reverts_in_the_token() public {
        bytes32 salt = keccak256("one deposit");
        _depositWithSalt(BOND, salt);
        uint256 credited = escrow.bondOf(seller);
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) =
            _authorizationSig(sellerKey, seller, address(escrow), BOND, validAfter, validBefore, _depositNonce(BOND, salt));

        vm.expectRevert(bytes("authorization is used"));
        escrow.depositBond(seller, BOND, validAfter, validBefore, salt, v, r, s);

        assertEq(escrow.bondOf(seller), credited);
    }

    function test_deposit_bond_refuses_zero_and_the_zero_payee() public {
        vm.expectRevert(ICountersignedEscrow.ZeroAmount.selector);
        escrow.depositBond(seller, 0, 0, block.timestamp + 600, keccak256("zero"), 0, bytes32(0), bytes32(0));

        vm.expectRevert(ICountersignedEscrow.ZeroAddress.selector);
        escrow.depositBond(address(0), BOND, 0, block.timestamp + 600, keccak256("zero"), 0, bytes32(0), bytes32(0));
    }

    function test_constructor_refuses_a_zero_arbiter() public {
        vm.expectRevert(ICountersignedEscrow.ZeroAddress.selector);
        new CountersignedEscrow(address(token), treasury, TOLL_BPS, address(0));
    }
}
