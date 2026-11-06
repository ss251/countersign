// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC8183Escrow} from "../src/erc8183/ERC8183Escrow.sol";
import {SlipHook} from "../src/erc8183/SlipHook.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

contract ERC8183EscrowTest is Test {
    MockEIP3009 internal token;
    ERC8183Escrow internal escrow;

    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal evaluator = makeAddr("evaluator");
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller;
    uint256 internal sellerKey;

    bytes32 internal constant OFFER = keccak256("offer: summarise a SKILL.md");
    bytes32 internal constant SLIP = keccak256("slip");
    uint256 internal constant PRICE = 1_500_000;
    uint16 internal constant TOLL_BPS = 100;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        token = new MockEIP3009();
        escrow = new ERC8183Escrow(address(token), treasury, TOLL_BPS, evaluator);
        token.mint(buyer, 100_000_000);
        assertEq(escrow.complete.selector, escrow.COMPLETE_SELECTOR());
    }

    function _countersign(bytes32 offerHash, address payee, uint256 amount, uint64 deadline, uint256 salt)
        internal
        view
        returns (ERC8183Escrow.Countersignature memory cs)
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

    function _cs() internal view returns (ERC8183Escrow.Countersignature memory) {
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

    function _funded() internal returns (bytes32 jobId) {
        ERC8183Escrow.Countersignature memory cs = _cs();
        jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt);
        vm.prank(stranger);
        escrow.fund(OFFER, cs);
    }

    function _sawSlip(bytes32 jobId) internal view returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("SlipCommitted(uint256,bytes32,bytes32)");
        address emitter = escrow.hook();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != emitter || logs[i].topics.length < 3 || logs[i].topics[0] != topic) continue;
            if (logs[i].topics[2] != jobId) continue;
            return abi.decode(logs[i].data, (bytes32)) == SLIP;
        }
        return false;
    }

    function test_fund_locks_the_budget_on_an_8183_job() public {
        ERC8183Escrow.Countersignature memory cs = _cs();
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt);

        vm.prank(stranger);
        uint256 acpJobId = escrow.fund(OFFER, cs);

        ERC8183Escrow.Job memory job = escrow.jobOf(jobId);
        assertEq(acpJobId, 1);
        assertEq(job.acpJobId, 1);
        assertEq(job.client, buyer);
        assertEq(job.provider, seller);
        assertEq(job.evaluator, evaluator);
        assertEq(job.description, OFFER);
        assertEq(job.budget, PRICE);
        assertEq(job.expiredAt, cs.deadline);
        assertEq(uint256(job.status), uint256(ERC8183Escrow.Status.Funded));
        assertEq(job.hook, escrow.hook());
        assertEq(job.deliverable, bytes32(0));
        assertEq(escrow.statusOf(jobId), uint8(ERC8183Escrow.Status.Funded));
        assertEq(token.balanceOf(address(escrow)), PRICE);
        assertEq(token.balanceOf(buyer), 100_000_000 - PRICE);
    }

    function test_complete_pays_the_provider_and_the_hook_emits_the_slip() public {
        bytes32 jobId = _funded();
        uint256 toll = escrow.tollOf(PRICE);

        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.recordLogs();
        vm.prank(evaluator);
        escrow.complete(jobId, SLIP, sig);

        assertTrue(_sawSlip(jobId));
        ERC8183Escrow.Job memory job = escrow.jobOf(jobId);
        assertEq(uint256(job.status), uint256(ERC8183Escrow.Status.Completed));
        assertEq(job.deliverable, SLIP);
        assertEq(token.balanceOf(seller), PRICE - toll);
        assertEq(token.balanceOf(treasury), toll);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_fund_does_not_emit_the_slip() public {
        ERC8183Escrow.Countersignature memory cs = _cs();
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt);
        vm.recordLogs();
        vm.prank(stranger);
        escrow.fund(OFFER, cs);
        assertFalse(_sawSlip(jobId));
    }

    function test_complete_refuses_anyone_but_the_evaluator() public {
        bytes32 jobId = _funded();
        bytes memory sig = _releaseSig(sellerKey, jobId, SLIP);
        vm.expectRevert(abi.encodeWithSelector(ERC8183Escrow.NotEvaluator.selector, jobId));
        vm.prank(stranger);
        escrow.complete(jobId, SLIP, sig);
        assertEq(escrow.statusOf(jobId), uint8(ERC8183Escrow.Status.Funded));
    }

    function test_complete_refuses_a_zero_slip() public {
        bytes32 jobId = _funded();
        bytes memory sig = _releaseSig(sellerKey, jobId, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ERC8183Escrow.ZeroSlip.selector, jobId));
        vm.prank(evaluator);
        escrow.complete(jobId, bytes32(0), sig);
        assertEq(token.balanceOf(address(escrow)), PRICE);
    }

    function test_claimRefund_after_the_deadline_returns_the_budget_and_skips_the_hook() public {
        bytes32 jobId = _funded();
        uint256 before = token.balanceOf(buyer);

        vm.expectRevert(abi.encodeWithSelector(ERC8183Escrow.DeadlineNotReached.selector, jobId, escrow.jobOf(jobId).expiredAt));
        escrow.claimRefund(jobId);

        vm.warp(block.timestamp + 301);
        vm.recordLogs();
        vm.prank(stranger);
        escrow.claimRefund(jobId);

        assertFalse(_sawSlip(jobId));
        assertEq(uint256(escrow.jobOf(jobId).status), uint256(ERC8183Escrow.Status.Expired));
        assertEq(token.balanceOf(buyer), before + PRICE);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_reject_with_the_provider_signature_refunds_the_client() public {
        bytes32 jobId = _funded();
        uint256 before = token.balanceOf(buyer);
        vm.prank(stranger);
        escrow.reject(jobId, _cancelSig(sellerKey, jobId));
        assertEq(uint256(escrow.jobOf(jobId).status), uint256(ERC8183Escrow.Status.Rejected));
        assertEq(token.balanceOf(buyer), before + PRICE);
    }

    function test_a_second_fund_of_the_same_countersignature_reverts() public {
        ERC8183Escrow.Countersignature memory cs = _cs();
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt);
        escrow.fund(OFFER, cs);
        vm.expectRevert(abi.encodeWithSelector(ERC8183Escrow.JobExists.selector, jobId));
        escrow.fund(OFFER, cs);
    }

    function test_a_moved_price_reverts() public {
        ERC8183Escrow.Countersignature memory cs = _cs();
        cs.amount = PRICE + 1;
        vm.expectRevert();
        escrow.fund(OFFER, cs);
        assertEq(token.balanceOf(buyer), 100_000_000);
    }

    function test_the_hook_refuses_a_direct_call() public {
        SlipHook slip = SlipHook(escrow.hook());
        vm.expectRevert(SlipHook.NotEscrow.selector);
        slip.afterAction(1, escrow.complete.selector, abi.encode(SLIP, abi.encode(bytes32(uint256(1)))));
    }
}
