// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {CountersignedEscrow8183} from "../src/CountersignedEscrow8183.sol";
import {IAgenticCommerce, IACPHook} from "../src/IAgenticCommerce.sol";
import {JobHook} from "../src/JobHook.sol";
import {MockAgenticCommerce} from "./mocks/MockAgenticCommerce.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

contract CountersignedEscrow8183Test is Test {
    MockEIP3009 internal token;
    MockAgenticCommerce internal core;
    JobHook internal hook;
    CountersignedEscrow8183 internal escrow;

    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
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
        core = new MockAgenticCommerce(address(token));
        hook = new JobHook();
        escrow = new CountersignedEscrow8183(address(token), address(core), address(hook), treasury, TOLL_BPS);
        token.mint(buyer, 100_000_000);
    }

    // ------------------------------------------------------------------ helpers

    function _countersign(bytes32 offerHash, address payee, uint256 amount, uint64 deadline, uint256 salt)
        internal
        view
        returns (CountersignedEscrow8183.Countersignature memory cs)
    {
        cs.buyer = buyer;
        cs.payee = payee;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(offerHash, buyer, payee, amount, deadline, salt);
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

    function _cs() internal view returns (CountersignedEscrow8183.Countersignature memory) {
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

    function _funded() internal returns (bytes32 jobId, CountersignedEscrow8183.Countersignature memory cs) {
        cs = _cs();
        vm.prank(stranger); // the hub or a relayer submits; the buyer pays no gas
        jobId = escrow.fund(OFFER, cs);
    }

    function _coreJob(bytes32 jobId) internal view returns (IAgenticCommerce.Job memory) {
        return core.getJob(escrow.job8183Of(jobId));
    }

    // ------------------------------------------------------------------ fund

    function test_fund_opens_a_core_job_and_emits_funded() public {
        CountersignedEscrow8183.Countersignature memory cs = _cs();
        bytes32 expected = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt);
        vm.expectEmit(address(escrow));
        emit CountersignedEscrow8183.Funded(expected, OFFER, buyer, seller, PRICE, cs.deadline);
        bytes32 jobId = escrow.fund(OFFER, cs);

        assertEq(jobId, expected);
        uint256 id = escrow.job8183Of(jobId);
        assertTrue(id != 0);

        IAgenticCommerce.Job memory job = core.getJob(id);
        assertEq(job.client, address(escrow));
        assertEq(job.provider, address(escrow));
        assertEq(job.evaluator, address(escrow));
        assertEq(job.budget, PRICE);
        assertEq(uint8(job.status), uint8(IAgenticCommerce.JobStatus.Funded));
        uint256 minExpiry = block.timestamp + 6 minutes;
        assertEq(job.expiredAt, cs.deadline > minExpiry ? cs.deadline : minExpiry);

        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(address(core)), PRICE);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(CountersignedEscrow8183.Status.Funded));
    }

    // ------------------------------------------------------------------ settle

    function test_release_emits_the_slip_hook_and_pays() public {
        (bytes32 jobId,) = _funded();
        uint256 id = escrow.job8183Of(jobId);
        uint256 toll = PRICE * TOLL_BPS / 10_000;
        uint256 paid = PRICE - toll;
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);

        vm.expectEmit(address(hook));
        emit JobHook.SlipCommitted(id, SLIP, address(escrow));
        vm.expectEmit(address(escrow));
        emit CountersignedEscrow8183.Released(jobId, SLIP, seller, paid, toll);
        vm.prank(stranger);
        escrow.release(jobId, SLIP, sig);

        assertEq(paid + toll, PRICE);
        assertEq(token.balanceOf(seller), paid);
        assertEq(token.balanceOf(treasury), toll);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(uint8(_coreJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Completed));

        CountersignedEscrow8183.Job memory job = escrow.jobOf(jobId);
        assertEq(uint8(job.status), uint8(CountersignedEscrow8183.Status.Released));
        assertEq(job.slipHash, SLIP);
    }

    // ------------------------------------------------------------------ refusals

    function test_a_moved_price_reverts() public {
        CountersignedEscrow8183.Countersignature memory cs = _cs();
        cs.amount = PRICE + 1; // the price moved after the buyer signed
        bytes32 moved = escrow.jobIdFor(OFFER, buyer, seller, cs.amount, cs.deadline, cs.salt);
        vm.expectRevert(abi.encodeWithSelector(CountersignedEscrow8183.CountersignatureMismatch.selector, moved));
        escrow.fund(OFFER, cs);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    function test_a_replayed_countersignature_reverts() public {
        (bytes32 jobId, CountersignedEscrow8183.Countersignature memory cs) = _funded();
        vm.expectRevert(abi.encodeWithSelector(CountersignedEscrow8183.JobExists.selector, jobId));
        escrow.fund(OFFER, cs);
    }

    function test_release_after_the_deadline_reverts() public {
        (bytes32 jobId, CountersignedEscrow8183.Countersignature memory cs) = _funded();
        vm.warp(uint256(cs.deadline) + 1);
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(CountersignedEscrow8183.DeadlinePassed.selector, jobId, cs.deadline));
        escrow.release(jobId, SLIP, sig);
    }

    function test_a_second_release_reverts() public {
        (bytes32 jobId,) = _funded();
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        escrow.release(jobId, SLIP, sig);
        vm.expectRevert(abi.encodeWithSelector(CountersignedEscrow8183.NotFunded.selector, jobId));
        escrow.release(jobId, SLIP, sig);
    }

    // ------------------------------------------------------------------ refunds

    function test_refund_before_the_deadline_reverts_then_a_stranger_refunds() public {
        (bytes32 jobId, CountersignedEscrow8183.Countersignature memory cs) = _funded();
        vm.warp(cs.deadline); // the deadline itself still belongs to the seller
        vm.expectRevert(abi.encodeWithSelector(CountersignedEscrow8183.DeadlineNotReached.selector, jobId, cs.deadline));
        escrow.refund(jobId);

        vm.warp(uint256(cs.deadline) + 1);
        vm.expectEmit(address(escrow));
        emit CountersignedEscrow8183.Refunded(jobId, buyer, PRICE, false);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(token.balanceOf(buyer), 100_000_000);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(CountersignedEscrow8183.Status.Refunded));
    }

    function test_refund_falls_back_to_claim_refund() public {
        (bytes32 jobId,) = _funded();
        core.setRejectReverts(true);
        uint256 expiredAt = _coreJob(jobId).expiredAt;
        vm.warp(expiredAt + 1);

        vm.expectEmit(address(escrow));
        emit CountersignedEscrow8183.Refunded(jobId, buyer, PRICE, false);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(token.balanceOf(buyer), 100_000_000);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(uint8(_coreJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    function test_the_payee_cancel_signature_refunds() public {
        (bytes32 jobId,) = _funded();
        bytes memory sig = _cancelSig(sellerKey, jobId);
        vm.expectEmit(address(escrow));
        emit CountersignedEscrow8183.Refunded(jobId, buyer, PRICE, true);
        vm.prank(stranger);
        escrow.cancel(jobId, sig);

        assertEq(token.balanceOf(buyer), 100_000_000);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(CountersignedEscrow8183.Status.Refunded));
    }

    // ------------------------------------------------------------------ the core's fee

    function test_a_core_fee_reverts_release_and_refund_returns_the_full_amount() public {
        core.setSkimBps(100);
        (bytes32 jobId, CountersignedEscrow8183.Countersignature memory cs) = _funded();
        uint256 skim = PRICE * 100 / 10_000;
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);

        vm.expectRevert(
            abi.encodeWithSelector(CountersignedEscrow8183.CoreFeeTaken.selector, PRICE - skim, PRICE)
        );
        escrow.release(jobId, SLIP, sig);

        vm.warp(uint256(cs.deadline) + 1);
        escrow.refund(jobId);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    // ------------------------------------------------------------------ the expiry floor

    function test_a_short_offer_deadline_still_funds() public {
        CountersignedEscrow8183.Countersignature memory cs =
            _countersign(OFFER, seller, PRICE, uint64(block.timestamp + 60), 9);
        bytes32 jobId = escrow.fund(OFFER, cs);

        IAgenticCommerce.Job memory job = _coreJob(jobId);
        assertGe(job.expiredAt, block.timestamp + 6 minutes);
        assertEq(uint8(job.status), uint8(IAgenticCommerce.JobStatus.Funded));

        escrow.release(jobId, SLIP, _releaseSig(sellerKey, jobId, SLIP));
        assertEq(uint8(_coreJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Completed));
    }

    // ------------------------------------------------------------------ the hook alone

    function test_job_hook_emits_the_slip_on_submit() public {
        bytes memory data = abi.encode(address(this), SLIP, bytes(""));
        vm.expectEmit(address(hook));
        emit JobHook.SlipCommitted(7, SLIP, address(this));
        hook.afterAction(7, IAgenticCommerce.submit.selector, data);
    }

    function test_job_hook_ignores_other_selectors_and_before_action() public {
        bytes memory data = abi.encode(address(this), SLIP, bytes(""));
        vm.recordLogs();
        hook.beforeAction(7, IAgenticCommerce.submit.selector, data);
        hook.afterAction(7, IAgenticCommerce.complete.selector, data);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_job_hook_supports_its_interface() public view {
        assertTrue(hook.supportsInterface(type(IACPHook).interfaceId));
        assertTrue(hook.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hook.supportsInterface(0xffffffff));
    }
}
