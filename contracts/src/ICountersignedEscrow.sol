// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICountersignedEscrow
/// @notice Escrow keyed to a buyer's countersignature. One signature from the buyer, an EIP-3009
///         ReceiveWithAuthorization naming this escrow, whose nonce is the jobId, binds the offer
///         hash, payee, amount, deadline, chain and escrow. Release is the payee's, before the
///         deadline. Refund is anyone's, after it.
interface ICountersignedEscrow {
    enum Status {
        None,
        Funded,
        Released,
        Refunded,
        Failed
    }

    /// @dev The buyer's terms plus the EIP-3009 authorisation fields. jobId = EIP-712 hash of
    ///      Countersign(offerHash, buyer, payee, amount, deadline, salt) under this escrow's domain.
    struct Countersignature {
        address buyer;
        address payee;
        uint256 amount;
        uint64 deadline;
        uint256 salt;
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

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
    event DeliveryFailed(bytes32 indexed jobId, address indexed buyer, uint256 amount, uint256 bond);

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

    /// @notice Pull `cs.amount` from the buyer into escrow and open the job.
    function fund(bytes32 offerHash, Countersignature calldata cs) external returns (bytes32 jobId);

    /// @notice Fund a job and lock `bond` from the payee's free bond into it. Arbiter only.
    function fundBonded(bytes32 offerHash, Countersignature calldata cs, uint256 bond)
        external
        returns (bytes32 jobId);

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

    /// @notice Pay the payee, less the toll, against a slip the payee signed. Before the deadline only.
    function release(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external;

    /// @notice Return the full amount to the buyer. Anyone may call it once the deadline has passed.
    function refund(bytes32 jobId) external;

    /// @notice Return the full amount to the buyer at the payee's word, at any time before release.
    ///         The payee calls it directly, or anyone submits it with the payee's Cancel signature.
    function cancel(bytes32 jobId, bytes calldata sellerSig) external;

    /// @notice The arbiter's verdict that delivery failed: the buyer gets `amount + bond`, with no toll.
    function failDelivery(bytes32 jobId) external;

    function jobIdFor(bytes32 offerHash, address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt)
        external
        view
        returns (bytes32);

    function jobOf(bytes32 jobId) external view returns (Job memory);

    function tollOf(uint256 amount) external view returns (uint256);

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
