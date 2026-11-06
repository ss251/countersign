// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICountersignedEscrow
/// @notice Escrow keyed to a buyer's countersignature (escrow v2, docs/spec/escrow.md "Escrow v2").
///         One signature from the buyer, an EIP-3009 ReceiveWithAuthorization naming this escrow,
///         whose nonce is the jobId, binds the offer hash, payee, amount, deadline, salt, bond,
///         review window, chain and escrow. A non-zero bond or window must match terms the payee
///         registered itself with setTerms.
interface ICountersignedEscrow {
    /// @dev Appended only, so v1 values keep their numbers.
    enum Status {
        None,
        Funded,
        Released,
        Refunded,
        Failed,
        Delivered,
        Disputed
    }

    /// @dev The buyer's terms plus the EIP-3009 authorisation fields. jobId = EIP-712 hash of
    ///      Countersign(offerHash, buyer, payee, amount, deadline, salt, bond, reviewWindow)
    ///      under this escrow's domain.
    struct Countersignature {
        address buyer;
        address payee;
        uint256 amount;
        uint64 deadline;
        uint256 salt;
        uint256 bond;
        uint64 reviewWindow;
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @dev Unchanged from v1, so jobOf decodes the same way on every deployment.
    struct Job {
        address buyer;
        uint64 deadline;
        Status status;
        address payee;
        uint256 amount;
        bytes32 offerHash;
        bytes32 slipHash;
    }

    event Funded(
        bytes32 indexed jobId,
        bytes32 indexed offerHash,
        address indexed buyer,
        address payee,
        uint256 amount,
        uint64 deadline
    );
    event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll);
    event Refunded(bytes32 indexed jobId, address indexed buyer, uint256 amount, bool byPayee);
    event BondDeposited(address indexed payee, uint256 amount);
    event BondWithdrawn(address indexed payee, uint256 amount);
    event BondLocked(bytes32 indexed jobId, address indexed payee, uint256 bond);
    event BondReturned(bytes32 indexed jobId, address indexed payee, uint256 bond);
    event BondForfeited(bytes32 indexed jobId, address indexed buyer, uint256 bond);
    event TermsSet(
        address indexed payee,
        bytes32 indexed offerHash,
        uint256 price,
        uint256 bond,
        uint64 reviewWindow,
        uint64 minDuration
    );
    event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);
    event Delivered(bytes32 indexed jobId, bytes32 indexed slipHash, uint64 deliveredAt, uint64 reviewEndsAt);
    event Accepted(bytes32 indexed jobId, address indexed buyer);
    event WindowElapsed(bytes32 indexed jobId);
    event Disputed(bytes32 indexed jobId, address indexed buyer);
    event TollSwept(address indexed treasury, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error TollTooHigh(uint16 tollBps);
    error DeadlineInPast(uint64 deadline);
    error JobExists(bytes32 jobId);
    error CountersignatureMismatch(bytes32 jobId);
    error TransferShortfall(bytes32 jobId);
    error NotFunded(bytes32 jobId);
    error DeadlinePassed(bytes32 jobId, uint64 deadline);
    error DeadlineNotReached(bytes32 jobId, uint64 deadline);
    error NotPayee(bytes32 jobId);
    error NotArbiter();
    error BondMissing(address payee, uint256 requested, uint256 available);
    error TermsMismatch(bytes32 jobId);
    error BondTooHigh(uint256 bond, uint256 price);
    error BondNeedsWindow();
    error BondNeedsDuration();
    error BadPayee(address payee);
    error ReviewTooLong(uint64 reviewWindow);
    error SettleWindowClosed(bytes32 jobId, uint256 settleBy);
    error SettleWindowOpen(bytes32 jobId, uint256 settleBy);
    error NotBuyer(bytes32 jobId);
    error NotDelivered(bytes32 jobId);
    error ReviewOpen(bytes32 jobId, uint64 endsAt);
    error ReviewClosed(bytes32 jobId, uint64 endsAt);
    error NotOpen(bytes32 jobId);
    error LockMissing(bytes32 jobId);
    error StatusMismatch(bytes32 jobId, uint8 status);

    /// @notice Pull `cs.amount` from the buyer into escrow and open the job. Anyone may submit an
    ///         unbonded job. A bonded job needs the payee's Lock(jobId, funder) signature, and only
    ///         that funder, as msg.sender, may submit it.
    ///         A non-zero `cs.bond` or `cs.reviewWindow` must match the payee's registered terms,
    ///         and the bond moves from the payee's free bond into the job.
    function fund(bytes32 offerHash, Countersignature calldata cs, bytes calldata lockSig)
        external
        returns (bytes32 jobId);

    /// @notice The caller, as payee, states the only price, bond and window a bonded or windowed
    ///         job on `offerHash` may carry, and the shortest time to its deadline at funding.
    ///         A bond needs a review window of at least MIN_BONDED_REVIEW_WINDOW: with window 0, or a
    ///         window too short to dispute in, the payee releases on any receipt and takes the payment
    ///         plus its whole bond back. A bond also needs minDuration of at least
    ///         MIN_BONDED_DURATION, so a bonded job is never opened too close to its deadline.
    function setTerms(bytes32 offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration)
        external;

    /// @notice Credit a payee's free bond with an EIP-3009 authorisation. Anyone may submit it.
    ///         The token nonce is derived from `salt`: keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH,
    ///         payee, amount, salt)), so it can never equal a jobId.
    function depositBond(
        address payee,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice Withdraw from the caller's own free bond.
    function withdrawBond(uint256 amount) external;

    /// @notice The payee's signed Release(jobId, slipHash). With review window 0 it pays the payee,
    ///         less the toll. With a window it records the delivery and starts the review.
    function release(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external;

    /// @notice The buyer accepts a delivered job: the payee is paid at once. The buyer calls it, or
    ///         anyone submits it with the buyer's Accept(jobId, slipHash) signature.
    function accept(bytes32 jobId, bytes calldata buyerSig) external;

    /// @notice Anyone pays a delivered job once its review window has ended.
    function releaseAfterWindow(bytes32 jobId) external;

    /// @notice The buyer disputes a funded job until the deadline, or a delivered one until the
    ///         review window ends, and is refunded at once. The buyer calls it, or anyone submits it
    ///         with the buyer's Dispute(jobId, status) signature, where status is the job's status
    ///         when the buyer signed.
    function dispute(bytes32 jobId, uint8 signedStatus, bytes calldata buyerSig) external;

    /// @notice Return a funded job's payment to the buyer once it can no longer be settled.
    function refund(bytes32 jobId) external;

    /// @notice The payee's word that it will not be paid: the buyer gets the amount back. The payee
    ///         calls it directly, or anyone submits it with the payee's Cancel signature.
    function cancel(bytes32 jobId, bytes calldata sellerSig) external;

    /// @notice The arbiter's verdict that delivery failed: the buyer gets `amount + bond`, with no toll.
    function failDelivery(bytes32 jobId) external;

    /// @notice Pay the accrued toll to the treasury. Anyone may call it.
    function sweepToll() external;

    function jobIdFor(
        bytes32 offerHash,
        address buyer,
        address payee,
        uint256 amount,
        uint64 deadline,
        uint256 salt,
        uint256 bond,
        uint64 reviewWindow
    ) external view returns (bytes32);

    function jobOf(bytes32 jobId) external view returns (Job memory);

    /// @notice A job's review window, when it was delivered, and when its review ends (0 until delivered).
    function reviewOf(bytes32 jobId) external view returns (uint64 window, uint64 deliveredAt, uint64 endsAt);

    function termsOf(address payee, bytes32 offerHash)
        external
        view
        returns (uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration);

    function tollOf(uint256 amount) external view returns (uint256);

    function tollAccrued() external view returns (uint256);

    function bondOf(address payee) external view returns (uint256);

    function bondOfJob(bytes32 jobId) external view returns (uint256);
}

/// @dev The slice of EIP-3009 the escrow uses. USDC on Arc and USDT on Whitechain Sepolia both have it.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
