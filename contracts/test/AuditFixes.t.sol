// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev Signing helpers shared by the audit tests and the conservation handler.
abstract contract EscrowSigning is Test {
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

    function _lockSig(uint256 payeeKey, bytes32 jobId, address funder) internal view returns (bytes memory) {
        return _sig(payeeKey, keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId, funder)));
    }
}

/// @dev The captain's audit of the escrow (06 Nov, 19:45 IST) and the 19:40 decisions (D16):
///      docs/spec/escrow.md, "Escrow v2", "Regression tests". Each test is named for its finding.
contract AuditFixesTest is EscrowSigning {
    address internal treasury = makeAddr("treasury");
    address internal arbiter = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;
    address internal attacker;
    uint256 internal attackerKey;

    bytes32 internal constant OFFER = keccak256("offer: a bonded, reviewed skill");
    bytes32 internal constant OTHER_OFFER = keccak256("offer: one the seller never bonded");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000;
    uint256 internal constant BOND = 500_000;
    uint16 internal constant TOLL_BPS = 100;
    uint64 internal constant WINDOW = 3600;
    uint64 internal constant MIN_DURATION = 120;
    uint64 internal constant DEADLINE_IN = 300;
    uint64 internal constant DISPUTE_WINDOW = 600;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        (attacker, attackerKey) = makeAddrAndKey("attacker");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, TOLL_BPS, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(attacker, 100_000_000);
        token.mint(seller, 100_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _deposit(uint256 amount) internal {
        _depositFor(sellerKey, amount, keccak256(abi.encode("deposit", amount, block.timestamp)));
    }

    function _publish(uint256 bond, uint64 window) internal {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, bond, window, MIN_DURATION);
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

    /// The seller deposits and registers (bond, window); the buyer countersigns them; the arbiter funds.
    function _fundJob(uint256 salt, uint256 bond, uint64 window) internal returns (bytes32 jobId) {
        if (bond != 0) _deposit(bond);
        _publish(bond, window);
        ICountersignedEscrow.Countersignature memory cs;
        (cs, jobId) = _cs(salt, bond, window);
        vm.startPrank(arbiter);
        escrow.fund(OFFER, cs, bond == 0 ? bytes("") : _lockSig(sellerKey, jobId, arbiter));
        vm.stopPrank();
    }

    function _releaseSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, SLIP)));
    }

    function _cancelSig(bytes32 jobId) internal view returns (bytes memory) {
        return _sig(sellerKey, keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), jobId)));
    }

    function _disputeSig(bytes32 jobId, uint8 signedStatus) internal view returns (bytes memory) {
        return _sig(buyerKey, keccak256(abi.encode(escrow.DISPUTE_TYPEHASH(), jobId, signedStatus)));
    }

    function _settleBy(bytes32 jobId) internal view returns (uint256) {
        return uint256(escrow.jobOf(jobId).deadline) + DISPUTE_WINDOW;
    }

    function _status(bytes32 jobId) internal view returns (uint8) {
        return uint8(escrow.jobOf(jobId).status);
    }

    function _toll() internal pure returns (uint256) {
        return PRICE * TOLL_BPS / 10_000;
    }

    // ------------------------------------------------------------------ C1: the binding

    /// The audit's sequence: a buyer the attacker controls names a bonded payee, with that payee's
    /// whole bond, on an offer the payee never registered, at a price of 1 and a far deadline.
    function test_C1_no_bond_without_registered_terms() public {
        _deposit(BOND);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _countersignBy(
            attackerKey, OTHER_OFFER, seller, 1, uint64(block.timestamp + 3650 days), 1, BOND, 0
        );

        bytes memory lockSig = _lockSig(sellerKey, jobId, attacker);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OTHER_OFFER, cs, lockSig);

        assertEq(escrow.bondOf(seller), BOND, "the free bond is untouched");
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.None));
    }

    function test_C1_each_term_must_match() public {
        _deposit(2 * BOND);
        _publish(BOND, WINDOW);
        uint64 deadline = _deadline();
        ICountersignedEscrow.Countersignature memory cs;
        bytes32 jobId;

        (cs, jobId) = _countersignBy(buyerKey, OFFER, seller, PRICE, deadline, 1, BOND + 1, WINDOW);
        bytes memory lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);

        (cs, jobId) = _countersignBy(buyerKey, OFFER, seller, PRICE, deadline, 2, BOND, WINDOW + 1);
        lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);

        (cs, jobId) = _countersignBy(buyerKey, OFFER, seller, PRICE + 1, deadline, 3, BOND, WINDOW);
        lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);

        uint64 tooSoon = uint64(block.timestamp + MIN_DURATION - 1);
        (cs, jobId) = _countersignBy(buyerKey, OFFER, seller, PRICE, tooSoon, 4, BOND, WINDOW);
        lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);

        (cs, jobId) = _countersignBy(buyerKey, OTHER_OFFER, seller, PRICE, deadline, 5, BOND, WINDOW);
        lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OTHER_OFFER, cs, lockSig);

        assertEq(escrow.bondOf(seller), 2 * BOND, "no mismatch moved any bond");

        // The exact terms, with the deadline exactly minDuration away, fund.
        (cs, jobId) =
            _countersignBy(buyerKey, OFFER, seller, PRICE, uint64(block.timestamp + MIN_DURATION), 6, BOND, WINDOW);
        vm.startPrank(arbiter);
        escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId, arbiter));
        vm.stopPrank();
        assertEq(escrow.bondOfJob(jobId), BOND);
    }

    function test_C1_only_the_payee_sets_its_terms() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);

        // A stranger writes only its own entry.
        vm.prank(attacker);
        escrow.setTerms(OFFER, 1, 1, WINDOW, 60);
        (uint256 price, uint256 bond, uint64 window, uint64 minDuration) = escrow.termsOf(attacker, OFFER);
        assertEq(price, 1);
        assertEq(bond, 1);
        (price, bond, window, minDuration) = escrow.termsOf(seller, OFFER);
        assertEq(price, PRICE, "the seller's terms are unchanged");
        assertEq(bond, BOND);
        assertEq(window, WINDOW);
        assertEq(minDuration, MIN_DURATION);
        assertEq(escrow.bondOf(seller), BOND);

        // And the stranger's terms bind nothing of the seller's.
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) =
            _countersignBy(attackerKey, OFFER, seller, 1, uint64(block.timestamp + 1 days), 1, 1, WINDOW);
        bytes memory lockSig = _lockSig(sellerKey, jobId, address(this));
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TermsMismatch.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);
        assertEq(escrow.bondOf(seller), BOND);
    }

    function test_C1_bond_capped_at_the_price() public {
        vm.startPrank(seller);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.BondTooHigh.selector, PRICE + 1, PRICE));
        escrow.setTerms(OFFER, PRICE, PRICE + 1, WINDOW, MIN_DURATION);

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.ReviewTooLong.selector, uint64(86_401)));
        escrow.setTerms(OFFER, PRICE, BOND, 86_401, MIN_DURATION);

        // A bond equal to the price, and a one-day window, are allowed.
        escrow.setTerms(OFFER, PRICE, PRICE, 86_400, MIN_DURATION);
        vm.stopPrank();
        (, uint256 bond, uint64 window,) = escrow.termsOf(seller, OFFER);
        assertEq(bond, PRICE);
        assertEq(window, 86_400);
    }

    function test_C1_registered_terms_lock_exactly_the_bond() public {
        _deposit(BOND + 300_000);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, BOND, WINDOW);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondLocked(jobId, seller, BOND);
        vm.startPrank(arbiter);
        escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId, arbiter));
        vm.stopPrank();

        assertEq(escrow.bondOf(seller), 300_000, "only the registered bond left the free balance");
        assertEq(escrow.bondOfJob(jobId), BOND);
        (uint64 window, uint64 deliveredAt, uint64 endsAt) = escrow.reviewOf(jobId);
        assertEq(window, WINDOW);
        assertEq(deliveredAt, 0);
        assertEq(endsAt, 0);
    }

    // ------------------------------------------------------------------ M1

    function test_M1_front_run_with_other_terms_fails() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs,) = _cs(1, BOND, WINDOW);

        // Strip the bond from the buyer's signed terms.
        ICountersignedEscrow.Countersignature memory stripped = cs;
        stripped.bond = 0;
        bytes32 strippedId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, 0, WINDOW);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, strippedId));
        escrow.fund(OFFER, stripped, "");

        // Or strip the window.
        ICountersignedEscrow.Countersignature memory unwindowed = cs;
        unwindowed.bond = BOND;
        unwindowed.reviewWindow = 0;
        bytes32 unwindowedId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, BOND, 0);
        bytes memory unwindowedLock = _lockSig(sellerKey, unwindowedId, attacker);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, unwindowedId));
        escrow.fund(OFFER, unwindowed, unwindowedLock);

        assertEq(escrow.bondOf(seller), BOND);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    /// Since cs-audit's final pass on 53eed70 a front-run with the same terms is refused, not harmless: a
    /// stranger who lands the hub's pending fund first would leave the hub unable to dispatch the job.
    function test_M1_front_run_with_the_same_terms_is_refused() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 expected) = _cs(1, BOND, WINDOW);
        bytes memory lockSig = _lockSig(sellerKey, expected, arbiter);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, expected));
        escrow.fund(OFFER, cs, lockSig);

        vm.prank(arbiter);
        bytes32 jobId = escrow.fund(OFFER, cs, lockSig);

        assertEq(jobId, expected, "the named funder opened exactly the signed job");
        ICountersignedEscrow.Job memory job = escrow.jobOf(jobId);
        assertEq(job.buyer, buyer);
        assertEq(job.deadline, cs.deadline);
        assertEq(uint8(job.status), uint8(ICountersignedEscrow.Status.Funded));
        assertEq(job.payee, seller);
        assertEq(job.amount, PRICE);
        assertEq(job.offerHash, OFFER);
        assertEq(job.slipHash, bytes32(0));
        assertEq(escrow.bondOfJob(jobId), BOND);
        (uint64 window,,) = escrow.reviewOf(jobId);
        assertEq(window, WINDOW);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.JobExists.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);
    }

    // ------------------------------------------------------------------ C2 and the economics

    function test_C2_default_pays_amount_plus_bond() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.warp(_settleBy(jobId) + 1);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, false);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondForfeited(jobId, buyer, BOND);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND, "the silent seller's bond goes to the buyer");
        assertEq(escrow.bondOf(seller), 0);
        assertEq(escrow.bondOfJob(jobId), 0);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Refunded));
    }

    function test_C2_cancel_by_the_deadline_returns_the_bond() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.warp(escrow.jobOf(jobId).deadline);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, true);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondReturned(jobId, seller, BOND);
        vm.prank(seller);
        escrow.cancel(jobId, "");

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(escrow.bondOf(seller), BOND);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Refunded));
    }

    function test_C2_cancel_after_the_deadline_reverts() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint64 deadline = escrow.jobOf(jobId).deadline;
        bytes memory sig = _cancelSig(jobId);
        vm.warp(uint256(deadline) + 1);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.DeadlinePassed.selector, jobId, deadline));
        escrow.cancel(jobId, "");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.DeadlinePassed.selector, jobId, deadline));
        escrow.cancel(jobId, sig);

        assertEq(escrow.bondOfJob(jobId), BOND, "the bond stays locked for the default");
    }

    function test_dispute_inside_the_window_pays_amount_plus_bond() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        escrow.release(jobId, SLIP, _releaseSig(jobId));
        (,, uint64 endsAt) = escrow.reviewOf(jobId);
        uint256 buyerBefore = token.balanceOf(buyer);
        uint256 sellerBefore = token.balanceOf(seller);
        bytes memory sig = _disputeSig(jobId, uint8(ICountersignedEscrow.Status.Delivered));
        vm.warp(endsAt - 1);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Disputed(jobId, buyer);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, false);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondForfeited(jobId, buyer, BOND);
        vm.prank(stranger);
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Delivered), sig);

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND, "junk costs the seller the bond");
        assertEq(token.balanceOf(seller), sellerBefore, "the seller is not paid");
        assertEq(escrow.bondOf(seller), 0);
        assertEq(escrow.tollAccrued(), 0);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Disputed));
    }

    function test_dispute_before_delivery_returns_the_bond_to_the_payee() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 buyerBefore = token.balanceOf(buyer);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Disputed(jobId, buyer);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, false);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.BondReturned(jobId, seller, BOND);
        vm.prank(buyer);
        escrow.dispute(jobId, uint8(ICountersignedEscrow.Status.Funded), "");

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE, "the buyer gets the amount only");
        assertEq(escrow.bondOf(seller), BOND, "the bond goes back: the seller had no chance to deliver");
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Disputed));
    }

    function test_failDelivery_pays_amount_plus_bond() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 buyerBefore = token.balanceOf(buyer);

        vm.prank(stranger);
        vm.expectRevert(ICountersignedEscrow.NotArbiter.selector);
        escrow.failDelivery(jobId);

        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.DeliveryFailed(jobId, buyer, PRICE, BOND);
        vm.prank(arbiter);
        escrow.failDelivery(jobId);

        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND);
        assertEq(escrow.bondOf(seller), 0);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Failed));
    }

    // ------------------------------------------------------------------ H1 and L3

    function test_H1_failDelivery_and_release_land_until_settleBy() public {
        _publish(0, 0);
        bytes32[4] memory jobs;
        for (uint256 i; i < 4; ++i) {
            (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(i + 1, 0, 0);
            vm.prank(arbiter);
            escrow.fund(OFFER, cs, "");
            jobs[i] = jobId;
        }
        uint256 settleBy = _settleBy(jobs[0]);
        bytes memory late0 = _releaseSig(jobs[0]);
        bytes memory late2 = _releaseSig(jobs[2]);

        // At settleBy, after the deadline, a release and a gate failure still land.
        vm.warp(settleBy);
        escrow.release(jobs[0], SLIP, late0);
        assertEq(_status(jobs[0]), uint8(ICountersignedEscrow.Status.Released));
        vm.prank(arbiter);
        escrow.failDelivery(jobs[1]);
        assertEq(_status(jobs[1]), uint8(ICountersignedEscrow.Status.Failed));

        // One second later neither does.
        vm.warp(settleBy + 1);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowClosed.selector, jobs[2], settleBy));
        escrow.release(jobs[2], SLIP, late2);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowClosed.selector, jobs[3], settleBy));
        escrow.failDelivery(jobs[3]);
    }

    /// H1's bond property under "bond implies window" (cs-w1, review of bb29f4f): a bonded release that
    /// lands after the deadline but by settleBy is Delivered, and once the window passes with no dispute
    /// the seller is paid and gets its whole bond back.
    function test_H1_an_honest_late_release_keeps_the_bond_once_the_window_passes() public {
        bytes32 jobId = _fundJob(5, BOND, WINDOW);
        uint256 settleBy = _settleBy(jobId);
        bytes memory late = _releaseSig(jobId);

        vm.warp(settleBy);
        escrow.release(jobId, SLIP, late);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Delivered));
        assertEq(escrow.bondOf(seller), 0, "the bond stays locked through the window");

        uint256 sellerBefore = token.balanceOf(seller);
        vm.warp(block.timestamp + WINDOW + 1);
        escrow.releaseAfterWindow(jobId);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Released));
        assertEq(escrow.bondOf(seller), BOND, "an honest late release keeps the bond");
        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - escrow.tollOf(PRICE), "the seller is paid");
    }

    // ------------------------------------------------------------------ M2 (cs-audit's final pass on 53eed70): the lock names its funder

    /// The payee's lock, naming the one address that may fund with it.
    function _lockSigFor(uint256 payeeKey, bytes32 jobId, address funder) internal view returns (bytes memory) {
        return _sig(payeeKey, keccak256(abi.encode(keccak256("Lock(bytes32 jobId,address funder)"), jobId, funder)));
    }

    /// A lock that names no funder lets the buyer land the hub's pending fund first, or replay the public
    /// lockSig after the hub's fund reverts. The hub then never dispatches, and the buyer collects amount
    /// plus bond at refund. Only the funder the payee named may use its lock.
    function test_M2_only_the_named_funder_can_use_the_lock() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(1, BOND, WINDOW);
        bytes memory lockSig = _lockSigFor(sellerKey, jobId, arbiter);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, lockSig);
        assertEq(escrow.bondOf(seller), BOND, "no bond moved for anyone but the named funder");

        vm.prank(arbiter);
        escrow.fund(OFFER, cs, lockSig);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Funded));
        assertEq(escrow.bondOfJob(jobId), BOND);
    }

    /// The exploit itself: the payee signs the old funder-less Lock(jobId) for the hub, and the buyer lands
    /// fund with it first. Before the fix that funds; after it, a lock naming no funder opens nothing.
    function test_M2_the_buyer_cannot_open_the_bonded_job_with_the_payees_lock() public {
        _deposit(BOND);
        _publish(BOND, WINDOW);
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) = _cs(2, BOND, WINDOW);
        bytes memory funderless = _sig(sellerKey, keccak256(abi.encode(keccak256("Lock(bytes32 jobId)"), jobId)));

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, funderless);
        assertEq(escrow.bondOf(seller), BOND, "the buyer moved no bond");
    }

    /// A bonded job always leaves its payee time to deliver: terms with a bond need minDuration of at least
    /// 60 s, so not even the named funder can open a bonded job a second before its deadline.
    function test_M2_bonded_terms_need_a_minimum_duration() public {
        vm.startPrank(seller);
        vm.expectRevert(bytes4(keccak256("BondNeedsDuration()")));
        escrow.setTerms(OFFER, PRICE, BOND, WINDOW, 59);
        escrow.setTerms(OFFER, PRICE, BOND, WINDOW, 60);
        escrow.setTerms(OFFER, PRICE, 0, 0, 0); // no bond needs no minimum
        vm.stopPrank();
    }

    /// A bond's review window is a real window: at least 60 s, so the buyer has time to dispute before
    /// releaseAfterWindow pays the payee and returns its bond (cs-audit's M2 on 53eed70, its F7 on 81df37e).
    function test_M2_a_bonded_review_window_is_at_least_60_s() public {
        vm.startPrank(seller);
        vm.expectRevert(ICountersignedEscrow.BondNeedsWindow.selector);
        escrow.setTerms(OFFER, PRICE, BOND, 1, MIN_DURATION);
        vm.expectRevert(ICountersignedEscrow.BondNeedsWindow.selector);
        escrow.setTerms(OFFER, PRICE, BOND, 59, MIN_DURATION);
        escrow.setTerms(OFFER, PRICE, BOND, 60, MIN_DURATION);
        escrow.setTerms(OFFER, PRICE, 0, 1, 0); // without a bond, a short window binds nothing of the payee's
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ B (Grok's re-audit of 53eed70)

    /// Grok's exact attack: the seller misses the deadline, releases a junk slip inside (deadline, settleBy],
    /// and lets the review window lapse, so releaseAfterWindow would pay it and return the whole bond with
    /// nothing delivered. Past the deadline only the arbiter, which settles after the hub checked the
    /// delivery, may release: the job stays Funded and the default pays the buyer the amount plus the bond.
    function test_B_a_late_seller_cannot_release_junk_and_keep_the_bond() public {
        bytes32 jobId = _fundJob(7, BOND, WINDOW);
        uint256 settleBy = _settleBy(jobId);
        bytes32 junk = keccak256("no delivery");
        bytes memory junkSig = _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, junk)));
        bytes4 late = bytes4(keccak256("LateReleaseNeedsArbiter(bytes32)"));

        vm.warp(uint256(escrow.jobOf(jobId).deadline) + 1);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(late, jobId));
        escrow.release(jobId, junk, junkSig);
        vm.warp(settleBy);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(late, jobId));
        escrow.release(jobId, junk, junkSig);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Funded), "a late junk release opens no window");

        uint256 buyerBefore = token.balanceOf(buyer);
        vm.warp(settleBy + 1);
        escrow.refund(jobId);
        assertEq(token.balanceOf(buyer) - buyerBefore, PRICE + BOND, "the default pays the amount and the bond");
        assertEq(escrow.bondOf(seller), 0, "the late seller keeps no bond");
    }

    function test_H1_refund_waits_for_settleBy() public {
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 settleBy = _settleBy(jobId);

        vm.warp(uint256(escrow.jobOf(jobId).deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowOpen.selector, jobId, settleBy));
        escrow.refund(jobId);

        vm.warp(settleBy);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowOpen.selector, jobId, settleBy));
        escrow.refund(jobId);

        vm.warp(settleBy + 1);
        escrow.refund(jobId);
        assertEq(_status(jobId), uint8(ICountersignedEscrow.Status.Refunded));
    }

    /// "Until T" is now <= T and "after T" is now > T, for every boundary, at T - 2 .. T + 2.
    function testFuzz_L3_one_rule_for_every_boundary(uint8 which, uint8 step) public {
        which = uint8(bound(which, 0, 6));
        int256 delta = int256(uint256(bound(step, 0, 4))) - 2;
        bytes32 jobId = _fundJob(1, BOND, WINDOW);
        uint256 deadline = escrow.jobOf(jobId).deadline;
        uint256 settleBy = deadline + DISPUTE_WINDOW;

        bytes memory call;
        uint256 boundary;
        bool until; // true: allowed until the boundary; false: allowed only after it
        if (which == 0) {
            (call, boundary, until) = (abi.encodeCall(escrow.cancel, (jobId, _cancelSig(jobId))), deadline, true);
        } else if (which == 1) {
            (call, boundary, until) = (
                abi.encodeCall(
                    escrow.dispute,
                    (jobId, uint8(ICountersignedEscrow.Status.Funded), _disputeSig(jobId, uint8(ICountersignedEscrow.Status.Funded)))
                ),
                deadline,
                true
            );
        } else if (which == 2) {
            (call, boundary, until) = (abi.encodeCall(escrow.release, (jobId, SLIP, _releaseSig(jobId))), settleBy, true);
        } else if (which == 3) {
            (call, boundary, until) = (abi.encodeCall(escrow.failDelivery, (jobId)), settleBy, true);
        } else if (which == 4) {
            (call, boundary, until) = (abi.encodeCall(escrow.refund, (jobId)), settleBy, false);
        } else {
            escrow.release(jobId, SLIP, _releaseSig(jobId));
            (,, uint64 endsAt) = escrow.reviewOf(jobId);
            if (which == 5) {
                (call, boundary, until) = (
                    abi.encodeCall(
                        escrow.dispute,
                        (
                            jobId,
                            uint8(ICountersignedEscrow.Status.Delivered),
                            _disputeSig(jobId, uint8(ICountersignedEscrow.Status.Delivered))
                        )
                    ),
                    endsAt,
                    true
                );
            } else {
                (call, boundary, until) = (abi.encodeCall(escrow.releaseAfterWindow, (jobId)), endsAt, false);
            }
        }

        uint256 at = uint256(int256(boundary) + delta);
        vm.warp(at);
        vm.prank(which == 3 ? arbiter : stranger);
        (bool ok,) = address(escrow).call(call);
        assertEq(ok, until ? at <= boundary : at > boundary, "the boundary rule");
    }

    // ------------------------------------------------------------------ L1 and L2

    function test_L1_blocklisted_treasury_does_not_block_release() public {
        token.setBlocked(treasury, true);
        bytes32 jobId = _fundJob(1, 0, 0);
        uint256 sellerBefore = token.balanceOf(seller);

        escrow.release(jobId, SLIP, _releaseSig(jobId));

        assertEq(token.balanceOf(seller) - sellerBefore, PRICE - _toll(), "the seller is paid");
        assertEq(escrow.tollAccrued(), _toll(), "the toll waits in the escrow");

        vm.expectRevert(bytes("blocklisted"));
        escrow.sweepToll();

        token.setBlocked(treasury, false);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.TollSwept(treasury, _toll());
        vm.prank(stranger);
        escrow.sweepToll();
        assertEq(token.balanceOf(treasury), _toll());
        assertEq(escrow.tollAccrued(), 0);

        vm.expectRevert(ICountersignedEscrow.ZeroAmount.selector);
        escrow.sweepToll();
    }

    function test_L2_the_payee_cannot_be_the_escrow() public {
        (ICountersignedEscrow.Countersignature memory cs,) =
            _countersignBy(buyerKey, OFFER, address(escrow), PRICE, _deadline(), 1, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.BadPayee.selector, address(escrow)));
        escrow.fund(OFFER, cs, "");

        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.BadPayee.selector, address(escrow)));
        escrow.depositBond(address(escrow), BOND, 0, block.timestamp + 600, keccak256("x"), 0, bytes32(0), bytes32(0));

        assertEq(token.balanceOf(buyer), 100_000_000);
    }
}

/// @dev Drives every mutator in random order for invariant_conservation.
contract ConservationHandler is EscrowSigning {
    bytes32 internal constant WINDOWED = keccak256("offer: windowed");
    bytes32 internal constant DIRECT = keccak256("offer: no window");
    uint256 internal constant PRICE = 1_000_000;
    uint256 internal constant BOND = 400_000;
    uint64 internal constant WINDOW = 600;

    address internal immutable arbiter;
    uint256 internal immutable buyerKey;
    uint256 internal immutable sellerKey;
    address public immutable seller;
    address public immutable buyer;
    bytes32[] public jobs;
    uint256 internal salt;

    constructor(MockEIP3009 token_, CountersignedEscrow escrow_, address arbiter_) {
        token = token_;
        escrow = escrow_;
        arbiter = arbiter_;
        (buyer, buyerKey) = makeAddrAndKey("inv-buyer");
        (seller, sellerKey) = makeAddrAndKey("inv-seller");
        token.mint(buyer, 1e15);
        token.mint(seller, 1e15);
        vm.startPrank(seller);
        escrow.setTerms(WINDOWED, PRICE, BOND, WINDOW, 60);
        escrow.setTerms(DIRECT, PRICE, 0, 0, 0);
        vm.stopPrank();
    }

    function jobCount() external view returns (uint256) {
        return jobs.length;
    }

    function _job(uint256 i) internal view returns (bytes32) {
        return jobs[i % jobs.length];
    }

    /// kind 0 and 1: no bond, no window (needs no terms); 2: bonded and windowed.
    function fund(uint8 kind) external {
        kind = uint8(bound(kind, 0, 2));
        ++salt;
        bytes32 offer = kind == 2 ? WINDOWED : DIRECT;
        uint256 bond = kind == 2 ? BOND : 0;
        uint64 window = kind == 2 ? WINDOW : 0;
        if (bond != 0) _depositFor(sellerKey, bond, bytes32(salt));
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) =
            _countersignBy(buyerKey, offer, seller, PRICE, uint64(block.timestamp + 300), salt, bond, window);
        bytes memory lock = bond == 0 ? bytes("") : _lockSig(sellerKey, jobId, arbiter);
        if (bond != 0) vm.prank(arbiter);
        try escrow.fund(offer, cs, lock) {
            jobs.push(jobId);
        } catch {}
    }

    function release(uint256 i) external {
        if (jobs.length == 0) return;
        bytes32 jobId = _job(i);
        bytes memory sig = _sig(sellerKey, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, bytes32(i))));
        try escrow.release(jobId, bytes32(i), sig) {} catch {}
    }

    function accept(uint256 i) external {
        if (jobs.length == 0) return;
        vm.prank(buyer);
        try escrow.accept(_job(i), "") {} catch {}
    }

    function releaseAfterWindow(uint256 i) external {
        if (jobs.length == 0) return;
        try escrow.releaseAfterWindow(_job(i)) {} catch {}
    }

    function dispute(uint256 i) external {
        if (jobs.length == 0) return;
        bytes32 jobId = _job(i);
        vm.prank(buyer);
        try escrow.dispute(jobId, uint8(escrow.jobOf(jobId).status), "") {} catch {}
    }

    function cancel(uint256 i) external {
        if (jobs.length == 0) return;
        vm.prank(seller);
        try escrow.cancel(_job(i), "") {} catch {}
    }

    function failDelivery(uint256 i) external {
        if (jobs.length == 0) return;
        vm.prank(arbiter);
        try escrow.failDelivery(_job(i)) {} catch {}
    }

    function refund(uint256 i) external {
        if (jobs.length == 0) return;
        try escrow.refund(_job(i)) {} catch {}
    }

    function withdraw(uint256 amount) external {
        amount = bound(amount, 0, escrow.bondOf(seller));
        vm.prank(seller);
        try escrow.withdrawBond(amount) {} catch {}
    }

    function sweep() external {
        try escrow.sweepToll() {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 900));
    }
}

contract ConservationInvariantTest is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;
    ConservationHandler internal handler;

    function setUp() public {
        vm.warp(1_762_400_000);
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), makeAddr("treasury"), 100, makeAddr("arbiter"));
        handler = new ConservationHandler(token, escrow, makeAddr("arbiter"));
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = ConservationHandler.fund.selector;
        selectors[1] = ConservationHandler.release.selector;
        selectors[2] = ConservationHandler.accept.selector;
        selectors[3] = ConservationHandler.releaseAfterWindow.selector;
        selectors[4] = ConservationHandler.dispute.selector;
        selectors[5] = ConservationHandler.cancel.selector;
        selectors[6] = ConservationHandler.failDelivery.selector;
        selectors[7] = ConservationHandler.refund.selector;
        selectors[8] = ConservationHandler.withdraw.selector;
        selectors[9] = ConservationHandler.sweep.selector;
        selectors[10] = ConservationHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// The token balance is exactly the held amounts, every free and locked bond, and the accrued toll.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 64
    function invariant_conservation() public view {
        uint256 owed = escrow.bondOf(handler.seller()) + escrow.tollAccrued();
        uint256 n = handler.jobCount();
        for (uint256 i; i < n; ++i) {
            bytes32 jobId = handler.jobs(i);
            ICountersignedEscrow.Job memory job = escrow.jobOf(jobId);
            if (job.status == ICountersignedEscrow.Status.Funded || job.status == ICountersignedEscrow.Status.Delivered)
            {
                owed += job.amount;
            }
            owed += escrow.bondOfJob(jobId);
        }
        assertEq(token.balanceOf(address(escrow)), owed);
    }
}
