// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IACPHook, IAgenticCommerce} from "./IAgenticCommerce.sol";

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

/// @title CountersignedEscrow8183
/// @notice Countersign's escrow with v1's external interface and events, holding its money in an
///         ERC-8183 job on Arc's shared AgenticCommerce core. The adapter is the job's client,
///         provider and evaluator, so the buyer's one countersignature and the payee's release or
///         cancel signature are enough to move the job through the core.
contract CountersignedEscrow8183 is EIP712, ReentrancyGuard {
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
    uint16 public constant MAX_TOLL_BPS = 1_000;

    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

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

    error ZeroAddress();
    error ZeroAmount();
    error ZeroSlip(bytes32 jobId);
    error TollTooHigh(uint16 tollBps);
    error DeadlineInPast(uint64 deadline);
    error JobExists(bytes32 jobId);
    error CountersignatureMismatch(bytes32 jobId);
    error TransferShortfall(bytes32 jobId);
    error NotFunded(bytes32 jobId);
    error DeadlinePassed(bytes32 jobId, uint64 deadline);
    error DeadlineNotReached(bytes32 jobId, uint64 deadline);
    error NotPayee(bytes32 jobId);
    error CoreFeeTaken(uint256 received, uint256 expected);

    IERC20 public immutable token;
    IAgenticCommerce public immutable core;
    IACPHook public immutable hook;
    address public immutable treasury;
    uint16 public immutable tollBps;

    mapping(bytes32 jobId => Job) private _jobs;
    mapping(bytes32 jobId => uint256) public job8183Of;

    constructor(
        address token_,
        address core_,
        address hook_,
        address treasury_,
        uint16 tollBps_
    ) EIP712("Countersign", "1") {
        if (token_ == address(0) || core_ == address(0) || hook_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (tollBps_ > MAX_TOLL_BPS) revert TollTooHigh(tollBps_);
        token = IERC20(token_);
        core = IAgenticCommerce(core_);
        hook = IACPHook(hook_);
        treasury = treasury_;
        tollBps = tollBps_;
    }

    /// @notice Pull the buyer's countersigned amount and open a funded ERC-8183 job with it.
    function fund(bytes32 offerHash, Countersignature calldata cs) external nonReentrant returns (bytes32 jobId) {
        if (cs.amount == 0) revert ZeroAmount();
        if (cs.buyer == address(0) || cs.payee == address(0)) revert ZeroAddress();
        if (cs.deadline <= block.timestamp) revert DeadlineInPast(cs.deadline);

        jobId = jobIdFor(offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline, cs.salt);
        if (_jobs[jobId].status != Status.None) revert JobExists(jobId);
        _checkCountersignature(cs, jobId);

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

        token.forceApprove(address(core), cs.amount);
        uint256 minExpiry = block.timestamp + 6 minutes;
        uint256 afterDeadline = uint256(cs.deadline) + 1;
        uint256 expiredAt = afterDeadline > minExpiry ? afterDeadline : minExpiry;
        uint256 id = core.createJob(
            address(this),
            address(this),
            expiredAt,
            string.concat("countersign:", Strings.toHexString(uint256(offerHash), 32)),
            address(0)
        );
        core.setBudget(id, cs.amount, "");
        core.fund(id, "");

        job8183Of[jobId] = id;
        emit Funded(jobId, offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline);
    }

    /// @notice Submit the slip to the core, complete the job, commit the slip through the hook and
    ///         pay the payee less the toll. Before the deadline only, with the payee's signature.
    function release(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp > job.deadline) revert DeadlinePassed(jobId, job.deadline);
        if (slipHash == bytes32(0)) revert ZeroSlip(jobId);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, jobId, slipHash)));
        if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);

        uint256 id = job8183Of[jobId];
        core.submit(id, slipHash, "");
        uint256 before = token.balanceOf(address(this));
        core.complete(id, slipHash, "");
        uint256 received = token.balanceOf(address(this)) - before;
        uint256 amount = job.amount;
        if (received != amount) revert CoreFeeTaken(received, amount);

        hook.afterAction(id, IAgenticCommerce.submit.selector, abi.encode(address(this), slipHash, bytes("")));

        job.status = Status.Released;
        job.slipHash = slipHash;
        uint256 toll = tollOf(amount);
        uint256 paid = amount - toll;
        address payee = job.payee;

        token.safeTransfer(payee, paid);
        if (toll != 0) token.safeTransfer(treasury, toll);
        emit Released(jobId, slipHash, payee, paid, toll);
    }

    /// @notice Return the full amount to the buyer once the deadline has passed. Anyone may call it.
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp <= job.deadline) revert DeadlineNotReached(jobId, job.deadline);
        _refund(jobId, job, false);
    }

    /// @notice Return the full amount to the buyer at the payee's word, at any time before release.
    function cancel(bytes32 jobId, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (msg.sender != job.payee) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, jobId)));
            if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);
        }
        _refund(jobId, job, true);
    }

    function jobIdFor(bytes32 offerHash, address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(COUNTERSIGN_TYPEHASH, offerHash, buyer, payee, amount, deadline, salt))
        );
    }

    function jobOf(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function tollOf(uint256 amount) public view returns (uint256) {
        return (amount * tollBps) / 10_000;
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
            abi.encodePacked("\x19\x01", IERC3009(address(token)).DOMAIN_SEPARATOR(), authHash)
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, cs.v, cs.r, cs.s);
        if (err != ECDSA.RecoverError.NoError || signer != cs.buyer) revert CountersignatureMismatch(jobId);
    }

    /// @dev The token checks the same signature again and burns the nonce, so it can never be replayed.
    function _pull(Countersignature calldata cs, bytes32 jobId) private {
        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            cs.buyer, address(this), cs.amount, cs.validAfter, cs.validBefore, jobId, cs.v, cs.r, cs.s
        );
        if (token.balanceOf(address(this)) - before != cs.amount) revert TransferShortfall(jobId);
    }

    function _refund(bytes32 jobId, Job storage job, bool byPayee) private {
        uint256 id = job8183Of[jobId];
        uint256 amount = job.amount;
        uint256 before = token.balanceOf(address(this));
        IAgenticCommerce.JobStatus coreStatus = core.getJob(id).status;
        if (coreStatus == IAgenticCommerce.JobStatus.Funded || coreStatus == IAgenticCommerce.JobStatus.Submitted) {
            if (byPayee) {
                core.reject(id, bytes32("cancel"), "");
            } else {
                try core.reject(id, bytes32("deadline"), "") {} catch {
                    core.claimRefund(id);
                }
            }
            uint256 received = token.balanceOf(address(this)) - before;
            if (received != amount) revert CoreFeeTaken(received, amount);
        } else if (coreStatus == IAgenticCommerce.JobStatus.Expired || coreStatus == IAgenticCommerce.JobStatus.Rejected) {
            // The core already returned the budget to this contract: someone called claimRefund directly.
            if (before < amount) revert CoreFeeTaken(before, amount);
        } else {
            revert NotFunded(jobId);
        }

        job.status = Status.Refunded;
        address buyer = job.buyer;
        token.safeTransfer(buyer, amount);
        emit Refunded(jobId, buyer, amount, byPayee);
    }
}
