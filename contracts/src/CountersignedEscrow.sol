// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICountersignedEscrow, IERC3009} from "./ICountersignedEscrow.sol";

/// @title CountersignedEscrow (v2)
/// @notice Conditional escrow for software-to-software payments. No owner, no pause, no upgrade:
///         the token, treasury, toll and arbiter are fixed at deployment.
/// @dev    Time rule (L3): "until T" is `block.timestamp <= T`, "after T" is `block.timestamp > T`.
///         - deadline: the payee may cancel, and the buyer may dispute, an undelivered job until it.
///         - settleBy = deadline + DISPUTE_WINDOW: release and failDelivery land until it; refund opens after it.
///         - endsAt = deliveredAt + reviewWindow: the buyer may dispute a delivery until it;
///           releaseAfterWindow opens after it.
contract CountersignedEscrow is ICountersignedEscrow, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant COUNTERSIGN_TYPEHASH = keccak256(
        "Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt,uint256 bond,uint64 reviewWindow)"
    );
    bytes32 public constant RELEASE_TYPEHASH = keccak256("Release(bytes32 jobId,bytes32 slipHash)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 jobId)");
    bytes32 public constant ACCEPT_TYPEHASH = keccak256("Accept(bytes32 jobId,bytes32 slipHash)");
    bytes32 public constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 jobId,uint8 status)");
    /// @dev The payee names the one address that may fund with its lock (cs-audit, final pass on 53eed70).
    bytes32 public constant LOCK_TYPEHASH = keccak256("Lock(bytes32 jobId,address funder)");
    /// @dev EIP-3009's typehash, used to check the buyer's signature before the token does.
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    /// @dev The deposit nonce is derived from this typehash, so it can never equal a jobId.
    bytes32 public constant BOND_DEPOSIT_TYPEHASH =
        keccak256("BondDeposit(address payee,uint256 amount,bytes32 salt)");
    uint16 public constant MAX_TOLL_BPS = 1_000;
    /// @notice The longest review window a payee may register: one day.
    uint64 public constant MAX_REVIEW_WINDOW = 86_400;
    /// @notice H1: release and failDelivery may still land this long after the deadline.
    uint64 public constant DISPUTE_WINDOW = 600;
    /// @notice The least minDuration bonded terms may carry, so a bonded job always leaves its payee time to deliver.
    uint64 public constant MIN_BONDED_DURATION = 60;
    /// @notice The least review window bonded terms may carry, so a buyer has time to dispute before the bond returns.
    uint64 public constant MIN_BONDED_REVIEW_WINDOW = 60;

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable tollBps;
    /// @notice The only address that may call failDelivery: the hub's relayer, which runs the gate.
    address public immutable arbiter;

    struct BondTerms {
        uint256 price;
        uint256 bond;
        uint64 reviewWindow;
        uint64 minDuration;
    }

    struct Review {
        uint64 window;
        uint64 deliveredAt;
    }

    mapping(bytes32 jobId => Job) private _jobs;
    mapping(address payee => uint256) public bondOf;
    mapping(bytes32 jobId => uint256) private _jobBond;
    mapping(bytes32 jobId => Review) private _reviews;
    /// @notice Written only by the payee itself (C1): the bond and window any job on the offer may carry.
    mapping(address payee => mapping(bytes32 offerHash => BondTerms)) public termsOf;
    /// @notice Toll owed to the treasury, paid out by sweepToll (L1).
    uint256 public tollAccrued;

    constructor(address token_, address treasury_, uint16 tollBps_, address arbiter_) EIP712("Countersign", "1") {
        if (token_ == address(0) || treasury_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        if (tollBps_ > MAX_TOLL_BPS) revert TollTooHigh(tollBps_);
        token = IERC20(token_);
        treasury = treasury_;
        tollBps = tollBps_;
        arbiter = arbiter_;
    }

    // ------------------------------------------------------------------ funding and the payee's terms

    /// @inheritdoc ICountersignedEscrow
    function fund(bytes32 offerHash, Countersignature calldata cs, bytes calldata lockSig)
        external
        nonReentrant
        returns (bytes32 jobId)
    {
        if (cs.amount == 0) revert ZeroAmount();
        if (cs.buyer == address(0) || cs.payee == address(0)) revert ZeroAddress();
        if (cs.payee == address(this)) revert BadPayee(cs.payee);
        if (cs.deadline <= block.timestamp) revert DeadlineInPast(cs.deadline);

        jobId = jobIdFor(
            offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline, cs.salt, cs.bond, cs.reviewWindow
        );
        if (_jobs[jobId].status != Status.None) revert JobExists(jobId);
        _checkCountersignature(cs, jobId);

        BondTerms storage t = termsOf[cs.payee][offerHash];
        if (cs.bond != 0 || cs.reviewWindow != 0 || t.price != 0) {
            // C1: a bond or window moves only on a job matching, field for field, the payee's own terms.
            if (
                cs.bond != t.bond || cs.reviewWindow != t.reviewWindow || cs.amount != t.price
                    || uint256(cs.deadline) < block.timestamp + t.minDuration
            ) revert TermsMismatch(jobId);
            if (cs.reviewWindow != 0) _reviews[jobId].window = cs.reviewWindow;
        }
        if (cs.bond != 0) {
            // The lock names its funder: only that address may open the bonded job, so a lock seen in a
            // pending or reverted fund cannot be landed or replayed by anyone else.
            bytes32 lockDigest = _hashTypedDataV4(keccak256(abi.encode(LOCK_TYPEHASH, jobId, msg.sender)));
            if (!SignatureChecker.isValidSignatureNow(cs.payee, lockDigest, lockSig)) revert LockMissing(jobId);
            uint256 available = bondOf[cs.payee];
            if (available < cs.bond) revert BondMissing(cs.payee, cs.bond, available);
            bondOf[cs.payee] = available - cs.bond;
            _jobBond[jobId] = cs.bond;
            emit BondLocked(jobId, cs.payee, cs.bond);
        }

        _jobs[jobId] = Job({
            buyer: cs.buyer,
            deadline: cs.deadline,
            status: Status.Funded,
            payee: cs.payee,
            amount: cs.amount,
            offerHash: offerHash,
            slipHash: bytes32(0)
        });
        _pull(cs, jobId);

        emit Funded(jobId, offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline);
    }

    /// @inheritdoc ICountersignedEscrow
    function setTerms(bytes32 offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration)
        external
    {
        if (msg.sender == address(this)) revert BadPayee(msg.sender);
        if (bond > price) revert BondTooHigh(bond, price);
        if (bond != 0 && reviewWindow < MIN_BONDED_REVIEW_WINDOW) revert BondNeedsWindow();
        if (bond != 0 && minDuration < MIN_BONDED_DURATION) revert BondNeedsDuration();
        if (reviewWindow > MAX_REVIEW_WINDOW) revert ReviewTooLong(reviewWindow);
        termsOf[msg.sender][offerHash] =
            BondTerms({price: price, bond: bond, reviewWindow: reviewWindow, minDuration: minDuration});
        emit TermsSet(msg.sender, offerHash, price, bond, reviewWindow, minDuration);
    }

    /// @inheritdoc ICountersignedEscrow
    function depositBond(
        address payee,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert ZeroAddress();
        if (payee == address(this)) revert BadPayee(payee);

        bytes32 nonce = keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt));
        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            payee, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        if (token.balanceOf(address(this)) - before != amount) revert TransferShortfall(bytes32(0));

        bondOf[payee] += amount;
        emit BondDeposited(payee, amount);
    }

    /// @inheritdoc ICountersignedEscrow
    function withdrawBond(uint256 amount) external nonReentrant {
        address payee = msg.sender;
        uint256 available = bondOf[payee];
        if (amount > available) revert BondMissing(payee, amount, available);

        bondOf[payee] = available - amount;
        token.safeTransfer(payee, amount);
        emit BondWithdrawn(payee, amount);
    }

    // ------------------------------------------------------------------ delivery and review

    /// @inheritdoc ICountersignedEscrow
    function release(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        uint256 settleBy = _settleBy(job);
        if (block.timestamp > settleBy) revert SettleWindowClosed(jobId, settleBy);
        // B (Grok's re-audit of 53eed70): past the deadline only the arbiter settles, as the hub does once it
        // has checked the delivery. A seller who missed its deadline cannot release a junk slip into a
        // review window and take the payment plus its bond back when the window lapses.
        if (block.timestamp > job.deadline && msg.sender != arbiter) revert LateReleaseNeedsArbiter(jobId);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, jobId, slipHash)));
        if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);

        job.slipHash = slipHash;
        Review storage review = _reviews[jobId];
        if (review.window == 0) {
            _pay(jobId, job);
            return;
        }
        job.status = Status.Delivered;
        uint64 deliveredAt = uint64(block.timestamp);
        review.deliveredAt = deliveredAt;
        emit Delivered(jobId, slipHash, deliveredAt, deliveredAt + review.window);
    }

    /// @inheritdoc ICountersignedEscrow
    function accept(bytes32 jobId, bytes calldata buyerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Delivered) revert NotDelivered(jobId);
        _checkBuyer(job, jobId, keccak256(abi.encode(ACCEPT_TYPEHASH, jobId, job.slipHash)), buyerSig);

        emit Accepted(jobId, job.buyer);
        _pay(jobId, job);
    }

    /// @inheritdoc ICountersignedEscrow
    function releaseAfterWindow(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Delivered) revert NotDelivered(jobId);
        uint64 endsAt = _endsAt(jobId);
        if (block.timestamp <= endsAt) revert ReviewOpen(jobId, endsAt);

        emit WindowElapsed(jobId);
        _pay(jobId, job);
    }

    /// @inheritdoc ICountersignedEscrow
    function dispute(bytes32 jobId, uint8 signedStatus, bytes calldata buyerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        Status status = job.status;
        if (status == Status.None) revert NotFunded(jobId);
        if (status != Status.Funded && status != Status.Delivered) revert NotOpen(jobId);
        if (uint8(status) != signedStatus) revert StatusMismatch(jobId, signedStatus);
        _checkBuyer(job, jobId, keccak256(abi.encode(DISPUTE_TYPEHASH, jobId, signedStatus)), buyerSig);

        bool forfeit;
        if (status == Status.Funded) {
            // Before delivery the bond goes back: a buyer may not take it before the seller could deliver.
            if (block.timestamp > job.deadline) revert DeadlinePassed(jobId, job.deadline);
        } else {
            uint64 endsAt = _endsAt(jobId);
            if (block.timestamp > endsAt) revert ReviewClosed(jobId, endsAt);
            forfeit = true;
        }

        job.status = Status.Disputed;
        emit Disputed(jobId, job.buyer);
        _refund(jobId, job, false, forfeit);
    }

    // ------------------------------------------------------------------ closing without payment

    /// @inheritdoc ICountersignedEscrow
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        uint256 settleBy = _settleBy(job);
        if (block.timestamp <= settleBy) revert SettleWindowOpen(jobId, settleBy);

        // C2: a seller that neither delivered nor cancelled by the deadline loses the bond to the buyer.
        job.status = Status.Refunded;
        _refund(jobId, job, false, true);
    }

    /// @inheritdoc ICountersignedEscrow
    function cancel(bytes32 jobId, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        Status status = job.status;
        if (status == Status.None) revert NotFunded(jobId);
        if (status != Status.Funded) revert NotOpen(jobId);
        if (msg.sender != job.payee) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, jobId)));
            if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);
        }
        // C2: after the deadline an undelivered job is in default, and a late cancel would save the bond.
        if (status == Status.Funded && block.timestamp > job.deadline) revert DeadlinePassed(jobId, job.deadline);

        job.status = Status.Refunded;
        _refund(jobId, job, true, false);
    }

    /// @inheritdoc ICountersignedEscrow
    function failDelivery(bytes32 jobId) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        uint256 settleBy = _settleBy(job);
        if (block.timestamp > settleBy) revert SettleWindowClosed(jobId, settleBy);

        job.status = Status.Failed;
        address buyer = job.buyer;
        uint256 amount = job.amount;
        uint256 bond = _jobBond[jobId];
        if (bond != 0) _jobBond[jobId] = 0;

        token.safeTransfer(buyer, amount + bond);
        emit DeliveryFailed(jobId, buyer, amount, bond);
    }

    /// @inheritdoc ICountersignedEscrow
    function sweepToll() external nonReentrant {
        uint256 amount = tollAccrued;
        if (amount == 0) revert ZeroAmount();
        tollAccrued = 0;
        token.safeTransfer(treasury, amount);
        emit TollSwept(treasury, amount);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc ICountersignedEscrow
    function jobIdFor(
        bytes32 offerHash,
        address buyer,
        address payee,
        uint256 amount,
        uint64 deadline,
        uint256 salt,
        uint256 bond,
        uint64 reviewWindow
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(COUNTERSIGN_TYPEHASH, offerHash, buyer, payee, amount, deadline, salt, bond, reviewWindow)
            )
        );
    }

    /// @inheritdoc ICountersignedEscrow
    function jobOf(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @inheritdoc ICountersignedEscrow
    function reviewOf(bytes32 jobId) external view returns (uint64 window, uint64 deliveredAt, uint64 endsAt) {
        Review storage review = _reviews[jobId];
        window = review.window;
        deliveredAt = review.deliveredAt;
        endsAt = deliveredAt == 0 ? 0 : deliveredAt + window;
    }

    /// @inheritdoc ICountersignedEscrow
    function tollOf(uint256 amount) public view returns (uint256) {
        return (amount * tollBps) / 10_000;
    }

    /// @inheritdoc ICountersignedEscrow
    function bondOfJob(bytes32 jobId) external view returns (uint256) {
        return _jobBond[jobId];
    }

    /// @notice The EIP-712 domain separator for Countersign, Release, Cancel, Accept and Dispute messages.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ internals

    /// @dev Any change to the terms changes jobId, and with it the nonce the buyer signed.
    ///      Checking here turns a moved price into a named refusal instead of a token error.
    function _checkCountersignature(Countersignature calldata cs, bytes32 jobId) private view {
        bytes32 authHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                cs.buyer,
                address(this),
                cs.amount,
                cs.validAfter,
                cs.validBefore,
                jobId
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", IERC3009(address(token)).DOMAIN_SEPARATOR(), authHash)
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, cs.v, cs.r, cs.s);
        if (err != ECDSA.RecoverError.NoError || signer != cs.buyer) revert CountersignatureMismatch(jobId);
    }

    /// @dev The buyer itself, or a relayer holding the buyer's signature over `structHash`.
    function _checkBuyer(Job storage job, bytes32 jobId, bytes32 structHash, bytes calldata buyerSig) private view {
        if (msg.sender == job.buyer) return;
        if (!SignatureChecker.isValidSignatureNow(job.buyer, _hashTypedDataV4(structHash), buyerSig)) {
            revert NotBuyer(jobId);
        }
    }

    /// @dev The token checks the same signature again and burns the nonce, so it can never be replayed.
    function _pull(Countersignature calldata cs, bytes32 jobId) private {
        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            cs.buyer, address(this), cs.amount, cs.validAfter, cs.validBefore, jobId, cs.v, cs.r, cs.s
        );
        if (token.balanceOf(address(this)) - before != cs.amount) revert TransferShortfall(jobId);
    }

    /// @dev Pays the payee `amount - toll`, accrues the toll (L1) and returns the bond.
    function _pay(bytes32 jobId, Job storage job) private {
        job.status = Status.Released;
        uint256 toll = tollOf(job.amount);
        uint256 paid = job.amount - toll;
        address payee = job.payee;
        if (toll != 0) tollAccrued += toll;
        uint256 bond = _jobBond[jobId];
        if (bond != 0) {
            _jobBond[jobId] = 0;
            bondOf[payee] += bond;
        }

        token.safeTransfer(payee, paid);
        emit Released(jobId, job.slipHash, payee, paid, toll);
        if (bond != 0) emit BondReturned(jobId, payee, bond);
    }

    /// @dev The caller has already set the final status. `forfeit` pays the bond to the buyer.
    function _refund(bytes32 jobId, Job storage job, bool byPayee, bool forfeit) private {
        address buyer = job.buyer;
        uint256 amount = job.amount;
        address payee = job.payee;
        uint256 bond = _jobBond[jobId];
        if (bond != 0) {
            _jobBond[jobId] = 0;
            if (!forfeit) bondOf[payee] += bond;
        }

        token.safeTransfer(buyer, forfeit ? amount + bond : amount);
        emit Refunded(jobId, buyer, amount, byPayee);
        if (bond != 0) {
            if (forfeit) emit BondForfeited(jobId, buyer, bond);
            else emit BondReturned(jobId, payee, bond);
        }
    }

    function _settleBy(Job storage job) private view returns (uint256) {
        return uint256(job.deadline) + DISPUTE_WINDOW;
    }

    function _endsAt(bytes32 jobId) private view returns (uint64) {
        Review storage review = _reviews[jobId];
        return review.deliveredAt + review.window;
    }
}
