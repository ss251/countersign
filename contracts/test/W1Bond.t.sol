// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CountersignedEscrow} from "../src/CountersignedEscrow.sol";
import {ICountersignedEscrow} from "../src/ICountersignedEscrow.sol";
import {MockEIP3009} from "./mocks/MockEIP3009.sol";

/// @dev cs-w1 adversarial tests for the seller bond. A failing test here is a blocker.
contract W1BondTest is Test {
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

    bytes32 internal constant OFFER = keccak256("offer: a bonded skill");
    uint256 internal constant PRICE = 1_500_000;
    uint256 internal constant BOND = 500_000;
    uint64 internal constant REVIEW_WINDOW = 60;

    function setUp() public {
        vm.warp(1_762_400_000);
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        (seller, sellerKey) = makeAddrAndKey("seller");
        (stranger, strangerKey) = makeAddrAndKey("stranger");
        token = new MockEIP3009();
        escrow = new CountersignedEscrow(address(token), treasury, 100, arbiter);
        token.mint(buyer, 100_000_000);
        token.mint(seller, 10_000_000);
        token.mint(stranger, 10_000_000);
    }

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

    function _countersign(uint256 key, address from, uint256 amount, uint64 deadline, uint256 salt, uint256 bond)
        internal
        view
        returns (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId)
    {
        cs.buyer = from;
        cs.payee = seller;
        cs.amount = amount;
        cs.deadline = deadline;
        cs.salt = salt;
        cs.bond = bond;
        uint64 window = bond == 0 ? 0 : REVIEW_WINDOW;
        cs.reviewWindow = window;
        cs.validAfter = 0;
        cs.validBefore = block.timestamp + 600;
        jobId = escrow.jobIdFor(OFFER, from, seller, amount, deadline, salt, bond, window);
        (cs.v, cs.r, cs.s) = _authorization(key, from, amount, cs.validBefore, jobId);
    }

    function _sellerDeposits(uint256 amount) internal {
        bytes32 salt = keccak256("seller bond");
        bytes32 nonce = keccak256(abi.encode(escrow.BOND_DEPOSIT_TYPEHASH(), seller, amount, salt));
        uint256 validBefore = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _authorization(sellerKey, seller, amount, validBefore, nonce);
        vm.prank(seller);
        escrow.depositBond(seller, amount, 0, validBefore, salt, v, r, s);
    }

    /// B16. A buyer's countersignature is an EIP-3009 ReceiveWithAuthorization naming this escrow,
    /// which is exactly what depositBond accepts from anyone. Whoever holds it (the hub, or anyone
    /// who reads it from a pending fund transaction) can spend it as a bond deposit "for" the buyer:
    /// the buyer's money leaves its wallet, the nonce is burned, and the job can never be funded.
    function test_W1_B16_a_countersignature_cannot_be_spent_as_a_bond_deposit() public {
        (ICountersignedEscrow.Countersignature memory cs, bytes32 jobId) =
            _countersign(buyerKey, buyer, PRICE, uint64(block.timestamp + 300), 1, 0);

        vm.prank(stranger);
        try escrow.depositBond(buyer, cs.amount, cs.validAfter, cs.validBefore, jobId, cs.v, cs.r, cs.s) {} catch {}

        // The buyer's signature must still fund the job it was made for.
        assertEq(escrow.bondOf(buyer), 0, "the buyer's payment became a bond");
        bytes32 funded = escrow.fund(OFFER, cs, "");
        assertEq(funded, jobId);
        assertEq(uint8(escrow.jobOf(jobId).status), uint8(ICountersignedEscrow.Status.Funded));
    }

    /// Deploy gate (#98, D16: the bond binds to the payee's registered terms). Without that binding,
    /// anyone could fund a job of their own at the smallest amount, with a far deadline, and lock every
    /// unit of a seller's free bond in it: each real bonded purchase would then revert with BondMissing.
    function test_W1_deploy_gate_a_stranger_cannot_lock_a_sellers_free_bond() public {
        _sellerDeposits(BOND);
        vm.prank(seller);
        escrow.setTerms(OFFER, PRICE, BOND, REVIEW_WINDOW, 0);
        (ICountersignedEscrow.Countersignature memory junk,) =
            _countersign(strangerKey, stranger, 1, uint64(block.timestamp + 3650 days), 7, BOND);

        // The contract never sees the offer, only its hash, so the stranger names the seller's own.
        vm.prank(stranger);
        try escrow.fund(OFFER, junk, "") {} catch {}

        assertEq(escrow.bondOf(seller), BOND, "a stranger locked the seller's bond");
    }
}
