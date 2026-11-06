// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009, ITransferHook} from "./mocks/MockEIP3009.sol";

contract CountersignedEscrowTest is Test {
    MockEIP3009 internal token;
    CountersignedEscrow internal escrow;

    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal arbiter = makeAddr("arbiter");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("offer: summarise a SKILL.md");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000; // 1.50 USDC
    uint16 internal constant TOLL_BPS = 100; // 1%

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, TOLL_BPS, arbiter);
        token.mint(buyer, 100_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _countersign(bytes32 offerHash, address payee, uint256 amount, uint64 deadline, uint256 salt)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = payee;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(offerHash, buyer, payee, amount, deadline, salt, 0, 0);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        buyer,
                        address(escrow),
                        amount,
                        cs.validAfter,
                        cs.validBefore,
                        jobId
                    )
                )
            )
        );
        (cs.v, cs.r, cs.s) = vm.sign(buyerKey, digest);
    }

    function _cs() internal view returns (ICountersignedEscrow.Countersignature memory) {
        return _countersign(OFFER, seller, PRICE, uint64(block.timestamp + 300), 1);
    }

    function _sign712(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _releaseSig(uint256 key, bytes32 jobId, bytes32 slipHash) internal view returns (bytes memory) {
        return _sign712(key, keccak256(abi.encode(escrow.RELEASE_TYPEHASH(), jobId, slipHash)));
    }

    function _cancelSig(uint256 key, bytes32 jobId) internal view returns (bytes memory) {
        return _sign712(key, keccak256(abi.encode(escrow.CANCEL_TYPEHASH(), jobId)));
    }

    function _settleBy(ICountersignedEscrow.Countersignature memory cs) internal view returns (uint256) {
        return uint256(cs.deadline) + escrow.DISPUTE_WINDOW();
    }

    function _funded() internal returns (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) {
        cs = _cs();
        vm.prank(stranger); // the hub or a relayer submits; the buyer pays no gas
        jobId = escrow.fund(OFFER, cs, "");
    }

    // ------------------------------------------------------------------ the path that works

    function test_fund_locks_the_amount_under_the_countersigned_terms() public {
        ICountersignedEscrow.Countersignature memory cs = _cs();
        bytes32 expected = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, 0, 0);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Funded(expected, OFFER, buyer, seller, PRICE, cs.deadline);
        bytes32 jobId = escrow.fund(OFFER, cs, "");

        assertEq(jobId, expected);
        assertEq(token.balanceOf(address(escrow)), PRICE);
        assertEq(token.balanceOf(buyer), 100_000_000 - PRICE);
        ICountersignedEscrow.Job memory job = escrow.jobOf(jobId);
        assertEq(uint8(job.status), uint8(ICountersignedEscrow.Status.Funded));
        assertEq(job.payee, seller);
        assertEq(job.offerHash, OFFER);
    }

    function test_release_pays_the_seller_less_the_toll() public {
        (bytes32 jobId,) = _funded();
        uint256 toll = PRICE * TOLL_BPS / 10_000;
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Released(jobId, SLIP, seller, PRICE - toll, toll);
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        vm.stopPrank();

        assertEq(token.balanceOf(seller), PRICE - toll);
        assertEq(escrow.tollAccrued(), toll, "the toll accrues (L1)");
        assertEq(token.balanceOf(address(escrow)), toll);
        escrow.sweepToll();
        assertEq(token.balanceOf(treasury), toll);
        assertEq(token.balanceOf(address(escrow)), 0);
        ICountersignedEscrow.Job memory job = escrow.jobOf(jobId);
        assertEq(uint8(job.status), uint8(ICountersignedEscrow.Status.Released));
        assertEq(job.slipHash, SLIP);
    }

    // ------------------------------------------------------------------ the eight required refusals

    function test_replay_of_a_nonce_fails() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _funded();
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.JobExists.selector, jobId));
        escrow.fund(OFFER, cs, "");

        // Even once the job is closed, the token has burned the nonce.
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.JobExists.selector, jobId));
        escrow.fund(OFFER, cs, "");
        assertTrue(token.authorizationState(buyer, jobId));
    }

    function test_wrong_amount_fails() public {
        ICountersignedEscrow.Countersignature memory cs = _cs();
        cs.amount = PRICE + 1; // the price moved after the buyer signed
        bytes32 moved = escrow.jobIdFor(OFFER, buyer, seller, cs.amount, cs.deadline, cs.salt, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, moved));
        escrow.fund(OFFER, cs, "");
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    function test_release_after_settle_by_fails() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _funded();
        uint256 settleBy = _settleBy(cs);
        vm.warp(settleBy + 1);
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowClosed.selector, jobId, settleBy));
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, sig);
        vm.stopPrank();
    }

    function test_refund_before_settle_by_fails() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _funded();
        uint256 settleBy = _settleBy(cs);
        vm.warp(settleBy); // settleBy itself still belongs to the seller's release (H1)
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.SettleWindowOpen.selector, jobId, settleBy));
        escrow.refund(jobId);
    }

    function test_refund_by_a_stranger_succeeds() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _funded();
        vm.warp(_settleBy(cs) + 1);
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, false);
        vm.prank(stranger);
        escrow.refund(jobId);
        assertEq(token.balanceOf(buyer), 100_000_000);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_double_release_fails() public {
        (bytes32 jobId,) = _funded();
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, sig);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, sig);
        vm.stopPrank();
    }

    function test_double_refund_fails() public {
        (bytes32 jobId, ICountersignedEscrow.Countersignature memory cs) = _funded();
        vm.warp(_settleBy(cs) + 1);
        escrow.refund(jobId);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.refund(jobId);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    function test_reentrancy_on_the_payee_path_is_closed() public {
        Reenterer attacker = new Reenterer(escrow);
        token.setHook(address(attacker), true);
        ICountersignedEscrow.Countersignature memory cs =
            _countersign(OFFER, address(attacker), PRICE, uint64(block.timestamp + 300), 7);
        bytes32 jobId = escrow.fund(OFFER, cs, "");
        attacker.arm(jobId, SLIP);

        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, "");
        vm.stopPrank();

        assertEq(attacker.attempts(), 3, "the hook ran and tried all three ways back in");
        assertEq(attacker.successes(), 0, "every re-entry was refused");
        uint256 toll = PRICE * TOLL_BPS / 10_000;
        assertEq(token.balanceOf(address(attacker)), PRICE - toll);
        assertEq(token.balanceOf(address(escrow)), toll, "only the accrued toll is left");
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Released));
    }

    // ------------------------------------------------------------------ the rest of the surface

    function test_release_needs_the_payee_signature() public {
        (bytes32 jobId,) = _funded();
        (, uint256 strangerKey) = makeAddrAndKey("stranger-key");
        bytes memory sig = _releaseSig(strangerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotPayee.selector, jobId));
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, sig);
        vm.stopPrank();
    }

    function test_release_signature_is_bound_to_the_slip() public {
        (bytes32 jobId,) = _funded();
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotPayee.selector, jobId));
        vm.startPrank(arbiter);
        escrow.release(jobId, keccak256("another slip"), sig);
        vm.stopPrank();
    }

    function test_swapping_the_payee_fails() public {
        ICountersignedEscrow.Countersignature memory cs = _cs();
        cs.payee = stranger;
        bytes32 swapped = escrow.jobIdFor(OFFER, buyer, stranger, cs.amount, cs.deadline, cs.salt, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, swapped));
        escrow.fund(OFFER, cs, "");
    }

    function test_another_offer_hash_fails() public {
        ICountersignedEscrow.Countersignature memory cs = _cs();
        bytes32 other = keccak256("offer: the same thing at a new price");
        bytes32 jobId = escrow.jobIdFor(other, buyer, seller, cs.amount, cs.deadline, cs.salt, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, jobId));
        escrow.fund(other, cs, "");
    }

    function test_extending_the_deadline_fails() public {
        ICountersignedEscrow.Countersignature memory cs = _cs();
        cs.deadline += 1 days;
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, cs.amount, cs.deadline, cs.salt, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.CountersignatureMismatch.selector, jobId));
        escrow.fund(OFFER, cs, "");
    }

    function test_expired_authorisation_fails() public {
        ICountersignedEscrow.Countersignature memory cs =
            _countersign(OFFER, seller, PRICE, uint64(block.timestamp + 1 days), 1);
        vm.warp(cs.validBefore);
        vm.expectRevert(bytes("authorization is expired"));
        escrow.fund(OFFER, cs, "");
    }

    function test_deadline_in_the_past_fails() public {
        ICountersignedEscrow.Countersignature memory cs =
            _countersign(OFFER, seller, PRICE, uint64(block.timestamp), 1);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.DeadlineInPast.selector, cs.deadline));
        escrow.fund(OFFER, cs, "");
    }

    function test_zero_amount_fails() public {
        ICountersignedEscrow.Countersignature memory cs =
            _countersign(OFFER, seller, 0, uint64(block.timestamp + 300), 1);
        vm.expectRevert(ICountersignedEscrow.ZeroAmount.selector);
        escrow.fund(OFFER, cs, "");
    }

    function test_payee_cancels_early_and_the_buyer_is_whole() public {
        (bytes32 jobId,) = _funded();
        vm.expectEmit(address(escrow));
        emit ICountersignedEscrow.Refunded(jobId, buyer, PRICE, true);
        vm.prank(seller);
        escrow.cancel(jobId, "");
        assertEq(token.balanceOf(buyer), 100_000_000);
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, sig);
        vm.stopPrank();
    }

    function test_relayer_submits_the_payee_cancel() public {
        (bytes32 jobId,) = _funded();
        bytes memory sig = _cancelSig(sellerKey, jobId);
        vm.prank(stranger);
        escrow.cancel(jobId, sig);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    function test_stranger_cannot_cancel() public {
        (bytes32 jobId,) = _funded();
        (, uint256 strangerKey) = makeAddrAndKey("stranger-key");
        bytes memory sig = _cancelSig(strangerKey, jobId);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotPayee.selector, jobId));
        escrow.cancel(jobId, sig);
    }

    function test_unknown_job_cannot_be_closed() public {
        bytes32 jobId = keccak256("never funded");
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.refund(jobId);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, "");
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.NotFunded.selector, jobId));
        escrow.cancel(jobId, "");
    }

    function test_constructor_refuses_bad_parameters() public {
        vm.expectRevert(ICountersignedEscrow.ZeroAddress.selector);
        new CountersignedEscrow(address(0), treasury, 100, arbiter);
        vm.expectRevert(ICountersignedEscrow.ZeroAddress.selector);
        new CountersignedEscrow(address(token), address(0), 100, arbiter);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.TollTooHigh.selector, uint16(1_001)));
        new CountersignedEscrow(address(token), treasury, 1_001, arbiter);
    }

    function testFuzz_toll_and_payout_sum_to_the_amount(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000);
        ICountersignedEscrow.Countersignature memory cs =
            _countersign(OFFER, seller, amount, uint64(block.timestamp + 300), amount);
        bytes32 jobId = escrow.fund(OFFER, cs, "");
        vm.startPrank(arbiter);
        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        vm.stopPrank();
        assertEq(token.balanceOf(seller) + escrow.tollAccrued(), amount);
        assertEq(escrow.tollAccrued(), amount * TOLL_BPS / 10_000);
    }
}

/// @dev A payee contract that accepts any release signature (ERC-1271) and, when paid,
///      tries to re-enter release, refund and cancel.
contract Reenterer is ITransferHook {
    CountersignedEscrow internal immutable escrow;
    bytes32 internal jobId;
    bytes32 internal slipHash;
    bool internal armed;
    uint256 public attempts;
    uint256 public successes;

    constructor(CountersignedEscrow escrow_) {
        escrow = escrow_;
    }

    function arm(bytes32 jobId_, bytes32 slipHash_) external {
        jobId = jobId_;
        slipHash = slipHash_;
        armed = true;
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function onTokenTransfer(address, uint256) external {
        if (!armed) return;
        armed = false;
        attempts = 3;
        try escrow.release(jobId, slipHash, "") {
            successes++;
        } catch {}
        try escrow.refund(jobId) {
            successes++;
        } catch {}
        try escrow.cancel(jobId, "") {
            successes++;
        } catch {}
    }
}
