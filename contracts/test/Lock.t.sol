// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev The payee's Lock(jobId) replaces the forced default (option d): funding is open to anyone,
///      but a bonded job moves the payee's bond only with a signature the payee itself made.
contract LockTest is Test {
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
    uint256 internal constant PRICE = 1_500_000; // 1.50 USDC
    uint256 internal constant BOND = 500_000; // 0.50 USDC
    uint16 internal constant TOLL_BPS = 100; // 1%

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
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        bytes32 jobId = escrow.jobIdFor(offerHash, buyer, payee, amount, deadline, salt, bond, 0);
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

    function _jobId(uint256 bond) internal view returns (bytes32) {
        return escrow.jobIdFor(OFFER, buyer, seller, PRICE, uint64(block.timestamp + 300), 1, bond, 0);
    }

    /// The seller registers the offer's bond, as it does once at publish.
    function _terms(uint256 bond) internal {
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, bond, 0, 0);
    }

    function _lockSig(uint256 payeeKey, bytes32 jobId) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", escrow.domainSeparator(), keccak256(abi.encode(escrow.LOCK_TYPEHASH(), jobId)))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payeeKey, digest);
        return abi.encodePacked(r, s, v);
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

    function _assertBondLocked(bytes32 jobId) internal view {
        assertEq(escrow.bondOf(seller), 0, "the bond falls by exactly the bond");
        assertEq(escrow.bondOfJob(jobId), BOND, "the bond is locked to the job");
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Funded), "the job is funded");
    }

    /// The seller deposits and registers, the buyer countersigns, and `funder` submits the payee's lock.
    function _fundWithLock(address funder) internal returns (bytes32 jobId) {
        _deposit(BOND);
        _terms(BOND);
        ICountersignedEscrow.Countersignature memory cs = _cs(BOND);
        jobId = _jobId(BOND);

        vm.prank(funder);
        bytes32 fundedJobId = escrow.fund(OFFER, cs, _lockSig(sellerKey, jobId));

        assertEq(fundedJobId, jobId, "the funded job is the countersigned one");
        _assertBondLocked(jobId);
    }

    /// The seller deposits and registers, the buyer countersigns, and `funder` submits no lock.
    function _fundWithoutLock(address funder) internal {
        _deposit(BOND);
        _terms(BOND);
        ICountersignedEscrow.Countersignature memory cs = _cs(BOND);
        bytes32 jobId = _jobId(BOND);

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, "");

        assertEq(escrow.bondOf(seller), BOND, "the bond stays free");
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.None), "the job stays unopened");
    }

    // ------------------------------------------------------------------ the lock is the payee's

    function test_a_bonded_fund_without_a_lock_reverts() public {
        _fundWithoutLock(stranger);
    }

    function test_a_lock_signed_by_anyone_but_the_payee_reverts() public {
        _deposit(BOND);
        _terms(BOND);
        ICountersignedEscrow.Countersignature memory cs = _cs(BOND);
        bytes32 jobId = _jobId(BOND);

        bytes memory wrongLock = _lockSig(buyerKey, jobId);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ICountersignedEscrow.LockMissing.selector, jobId));
        escrow.fund(OFFER, cs, wrongLock);

        assertEq(escrow.bondOf(seller), BOND, "the bond stays free");
    }

    // ------------------------------------------------------------------ anyone may submit it

    function test_a_stranger_funds_with_the_payees_lock() public {
        _fundWithLock(stranger);
    }

    function test_the_buyer_funds_with_the_payees_lock() public {
        _fundWithLock(buyer);
    }

    function test_the_arbiter_funds_with_the_payees_lock() public {
        _fundWithLock(arbiter);
    }

    // ------------------------------------------------------------------ unbonded jobs need no lock

    function test_an_unbonded_fund_ignores_the_lock_signature() public {
        ICountersignedEscrow.Countersignature memory cs = _cs(0);
        bytes32 jobId = escrow.jobIdFor(OFFER, buyer, seller, PRICE, cs.deadline, cs.salt, 0, 0);

        vm.prank(stranger);
        bytes32 fundedJobId = escrow.fund(OFFER, cs, hex"deadbeef");

        assertEq(fundedJobId, jobId, "the funded job is the countersigned one");
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Funded), "the job is funded");
    }

    // ------------------------------------------------------------------ the forced default is closed

    function test_the_arbiter_cannot_fund_a_bonded_job_the_payee_never_locked() public {
        _fundWithoutLock(arbiter);
    }

    function test_the_buyer_cannot_fund_a_bonded_job_the_payee_never_locked() public {
        _fundWithoutLock(buyer);
    }
}
