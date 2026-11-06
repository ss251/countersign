// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// FROZEN TEST FIXTURE. Never deploy this contract.
//
// This is CountersignedEscrow as it stood on cs/int at 98c4c16, before escrow v2 (#98), with
// its interface inlined and renamed. It carries the audit findings C1, C2, H1, M1 and L1-L3.
// It exists only so the TypeScript suites that still speak the v1 ABI (packages/rail,
// packages/runner, packages/verify) keep running against real bytecode on anvil until the
// integration lane ports them to v2. Remove it with the last of those ports.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ICountersignedEscrowV1
/// @notice Escrow keyed to a buyer's countersignature. One signature from the buyer, an EIP-3009
///         ReceiveWithAuthorization naming this escrow, whose nonce is the jobId, binds the offer
///         hash, payee, amount, deadline, chain and escrow. Release is the payee's, before the
///         deadline. Refund is anyone's, after it.
interface ICountersignedEscrowV1 {
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
interface IERC3009V1 {
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

/// @title CountersignedEscrowV1 (frozen fixture)
/// @notice Conditional escrow for software-to-software payments. No owner, no pause, no upgrade:
///         the token, treasury, toll and arbiter are fixed at deployment.
contract CountersignedEscrowV1 is ICountersignedEscrowV1, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant COUNTERSIGN_TYPEHASH = keccak256(
        "Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt)"
    );
    bytes32 public constant RELEASE_TYPEHASH = keccak256("Release(bytes32 jobId,bytes32 slipHash)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 jobId)");
    /// @dev EIP-3009's typehash, used to check the buyer's signature before the token does.
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    /// @dev The deposit nonce is derived from this typehash, so it can never equal a jobId.
    bytes32 public constant BOND_DEPOSIT_TYPEHASH =
        keccak256("BondDeposit(address payee,uint256 amount,bytes32 salt)");
    uint16 public constant MAX_TOLL_BPS = 1_000;

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable tollBps;
    /// @notice The only address that may call failDelivery: the hub's relayer.
    address public immutable arbiter;

    mapping(bytes32 jobId => Job) private _jobs;
    mapping(address payee => uint256) public bondOf;
    mapping(bytes32 jobId => uint256) private _jobBond;

    constructor(address token_, address treasury_, uint16 tollBps_, address arbiter_) EIP712("Countersign", "1") {
        if (token_ == address(0) || treasury_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        if (tollBps_ > MAX_TOLL_BPS) revert TollTooHigh(tollBps_);
        token = IERC20(token_);
        treasury = treasury_;
        tollBps = tollBps_;
        arbiter = arbiter_;
    }

    /// @inheritdoc ICountersignedEscrowV1
    function fund(bytes32 offerHash, Countersignature calldata cs) external nonReentrant returns (bytes32 jobId) {
        return _fund(offerHash, cs, 0);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function fundBonded(bytes32 offerHash, Countersignature calldata cs, uint256 bond)
        external
        nonReentrant
        returns (bytes32 jobId)
    {
        if (msg.sender != arbiter) revert NotArbiter();
        return _fund(offerHash, cs, bond);
    }

    /// @inheritdoc ICountersignedEscrowV1
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

        bytes32 nonce = keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt));
        uint256 before = token.balanceOf(address(this));
        IERC3009V1(address(token)).receiveWithAuthorization(
            payee, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        if (token.balanceOf(address(this)) - before != amount) revert TransferShortfall(bytes32(0));

        bondOf[payee] += amount;
        emit BondDeposited(payee, amount);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function withdrawBond(uint256 amount) external nonReentrant {
        address payee = msg.sender;
        uint256 available = bondOf[payee];
        if (amount > available) revert BondMissing(payee, amount, available);

        bondOf[payee] = available - amount;
        token.safeTransfer(payee, amount);
        emit BondWithdrawn(payee, amount);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function release(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp > job.deadline) revert DeadlinePassed(jobId, job.deadline);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, jobId, slipHash)));
        if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);

        job.status = Status.Released;
        job.slipHash = slipHash;
        uint256 toll = tollOf(job.amount);
        uint256 paid = job.amount - toll;
        address payee = job.payee;
        _returnJobBond(jobId, payee);

        token.safeTransfer(payee, paid);
        if (toll != 0) token.safeTransfer(treasury, toll);
        emit Released(jobId, slipHash, payee, paid, toll);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp <= job.deadline) revert DeadlineNotReached(jobId, job.deadline);
        _refund(jobId, job, false);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function cancel(bytes32 jobId, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (msg.sender != job.payee) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, jobId)));
            if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);
        }
        _refund(jobId, job, true);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function failDelivery(bytes32 jobId) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp > job.deadline) revert DeadlinePassed(jobId, job.deadline);

        job.status = Status.Failed;
        address buyer = job.buyer;
        uint256 amount = job.amount;
        uint256 bond = _jobBond[jobId];
        if (bond != 0) _jobBond[jobId] = 0;

        token.safeTransfer(buyer, amount + bond);
        emit DeliveryFailed(jobId, buyer, amount, bond);
    }

    /// @inheritdoc ICountersignedEscrowV1
    function jobIdFor(bytes32 offerHash, address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(COUNTERSIGN_TYPEHASH, offerHash, buyer, payee, amount, deadline, salt))
        );
    }

    /// @inheritdoc ICountersignedEscrowV1
    function jobOf(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @inheritdoc ICountersignedEscrowV1
    function tollOf(uint256 amount) public view returns (uint256) {
        return (amount * tollBps) / 10_000;
    }

    /// @inheritdoc ICountersignedEscrowV1
    function bondOfJob(bytes32 jobId) external view returns (uint256) {
        return _jobBond[jobId];
    }

    /// @notice The EIP-712 domain separator for Countersign, Release and Cancel messages.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

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
            abi.encodePacked("\x19\x01", IERC3009V1(address(token)).DOMAIN_SEPARATOR(), authHash)
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, cs.v, cs.r, cs.s);
        if (err != ECDSA.RecoverError.NoError || signer != cs.buyer) revert CountersignatureMismatch(jobId);
    }

    function _fund(bytes32 offerHash, Countersignature calldata cs, uint256 bond)
        private
        returns (bytes32 jobId)
    {
        if (cs.amount == 0) revert ZeroAmount();
        if (cs.buyer == address(0) || cs.payee == address(0)) revert ZeroAddress();
        if (cs.deadline <= block.timestamp) revert DeadlineInPast(cs.deadline);

        jobId = jobIdFor(offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline, cs.salt);
        if (_jobs[jobId].status != Status.None) revert JobExists(jobId);
        _checkCountersignature(cs, jobId);

        if (bond > 0) {
            uint256 available = bondOf[cs.payee];
            if (available < bond) revert BondMissing(cs.payee, bond, available);
            bondOf[cs.payee] = available - bond;
            _jobBond[jobId] = bond;
            emit BondLocked(jobId, cs.payee, bond);
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

    /// @dev The token checks the same signature again and burns the nonce, so it can never be replayed.
    function _pull(Countersignature calldata cs, bytes32 jobId) private {
        uint256 before = token.balanceOf(address(this));
        IERC3009V1(address(token)).receiveWithAuthorization(
            cs.buyer, address(this), cs.amount, cs.validAfter, cs.validBefore, jobId, cs.v, cs.r, cs.s
        );
        if (token.balanceOf(address(this)) - before != cs.amount) revert TransferShortfall(jobId);
    }

    function _refund(bytes32 jobId, Job storage job, bool byPayee) private {
        job.status = Status.Refunded;
        address buyer = job.buyer;
        address payee = job.payee;
        uint256 amount = job.amount;
        _returnJobBond(jobId, payee);
        token.safeTransfer(buyer, amount);
        emit Refunded(jobId, buyer, amount, byPayee);
    }

    function _returnJobBond(bytes32 jobId, address payee) private {
        uint256 bond = _jobBond[jobId];
        if (bond == 0) return;
        _jobBond[jobId] = 0;
        bondOf[payee] += bond;
        emit BondReturned(jobId, payee, bond);
    }
}
