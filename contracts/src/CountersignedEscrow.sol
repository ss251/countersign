// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICountersignedEscrow, IERC3009} from "./ICountersignedEscrow.sol";

/// @title CountersignedEscrow
/// @notice Conditional escrow for software-to-software payments. No owner, no pause, no upgrade:
///         the token, treasury and toll are fixed at deployment.
contract CountersignedEscrow is ICountersignedEscrow, EIP712, ReentrancyGuard {
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

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable tollBps;

    mapping(bytes32 jobId => Job) private _jobs;

    constructor(address token_, address treasury_, uint16 tollBps_) EIP712("Countersign", "1") {
        if (token_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (tollBps_ > MAX_TOLL_BPS) revert TollTooHigh(tollBps_);
        token = IERC20(token_);
        treasury = treasury_;
        tollBps = tollBps_;
    }

    /// @inheritdoc ICountersignedEscrow
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

        emit Funded(jobId, offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline);
    }

    /// @inheritdoc ICountersignedEscrow
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

        token.safeTransfer(payee, paid);
        if (toll != 0) token.safeTransfer(treasury, toll);
        emit Released(jobId, slipHash, payee, paid, toll);
    }

    /// @inheritdoc ICountersignedEscrow
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp <= job.deadline) revert DeadlineNotReached(jobId, job.deadline);
        _refund(jobId, job, false);
    }

    /// @inheritdoc ICountersignedEscrow
    function cancel(bytes32 jobId, bytes calldata sellerSig) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status != Status.Funded) revert NotFunded(jobId);
        if (msg.sender != job.payee) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, jobId)));
            if (!SignatureChecker.isValidSignatureNow(job.payee, digest, sellerSig)) revert NotPayee(jobId);
        }
        _refund(jobId, job, true);
    }

    /// @inheritdoc ICountersignedEscrow
    function jobIdFor(bytes32 offerHash, address buyer, address payee, uint256 amount, uint64 deadline, uint256 salt)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(COUNTERSIGN_TYPEHASH, offerHash, buyer, payee, amount, deadline, salt))
        );
    }

    /// @inheritdoc ICountersignedEscrow
    function jobOf(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @inheritdoc ICountersignedEscrow
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
        job.status = Status.Refunded;
        address buyer = job.buyer;
        uint256 amount = job.amount;
        token.safeTransfer(buyer, amount);
        emit Refunded(jobId, buyer, amount, byPayee);
    }
}
