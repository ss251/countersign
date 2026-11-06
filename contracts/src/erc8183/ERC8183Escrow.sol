// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC3009} from "../ICountersignedEscrow.sol";
import {IJobHook} from "./IJobHook.sol";
import {SlipHook} from "./SlipHook.sol";

/// @title ERC8183Escrow
/// @notice Minimal ERC-8183 job escrow for one countersigned payment.
///         The buyer signs the same EIP-3009 authorisation as CountersignedEscrow. `fund`
///         opens the job and locks the budget in one transaction (the buyer pays no gas),
///         which is this contract's form of createJob + setBudget + fund.
///         `complete` is the settlement: the evaluator submits the provider's
///         Release signature, the job moves Funded → Submitted → Completed, and the
///         job hook emits the slip hash. `claimRefund` after the deadline is not hooked.
contract ERC8183Escrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant COUNTERSIGN_TYPEHASH = keccak256(
        "Countersign(bytes32 offerHash,address buyer,address payee,uint256 amount,uint64 deadline,uint256 salt)"
    );
    bytes32 public constant RELEASE_TYPEHASH = keccak256("Release(bytes32 jobId,bytes32 slipHash)");
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 jobId)");
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    /// @dev Selector passed to the hook for the submit half of `complete`. There is no
    ///      separate submit call: the hub releases a job once.
    bytes4 public constant SUBMIT_SELECTOR = bytes4(keccak256("submit(uint256,bytes32,bytes)"));
    bytes4 public constant COMPLETE_SELECTOR = bytes4(keccak256("complete(bytes32,bytes32,bytes)"));
    uint16 public constant MAX_TOLL_BPS = 1_000;
    uint256 public constant HOOK_GAS_LIMIT = 200_000;

    enum Status {
        None,
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
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
        uint256 acpJobId;
        address client;
        address provider;
        address evaluator;
        bytes32 description;
        uint256 budget;
        uint64 expiredAt;
        Status status;
        address hook;
        bytes32 deliverable;
    }

    IERC20 public immutable token;
    address public immutable treasury;
    uint16 public immutable tollBps;
    /// @notice The only address that may settle a job. The hub's relayer.
    address public immutable evaluator;
    /// @notice The SlipHook deployed with this escrow. Every job uses it.
    address public immutable hook;

    uint256 public jobCounter;
    mapping(bytes32 countersignJobId => uint256 acpJobId) private _acpOf;
    mapping(uint256 acpJobId => Job) private _jobs;

    event JobFunded(
        uint256 indexed acpJobId,
        bytes32 indexed jobId,
        address indexed client,
        address provider,
        uint256 budget,
        uint64 expiredAt
    );
    event JobSubmitted(uint256 indexed acpJobId, bytes32 indexed jobId, bytes32 deliverable);
    event JobCompleted(uint256 indexed acpJobId, bytes32 indexed jobId, bytes32 slipHash);
    event PaymentReleased(uint256 indexed acpJobId, address indexed provider, uint256 paid, uint256 toll);
    event JobRejected(uint256 indexed acpJobId, bytes32 indexed jobId, address indexed client, uint256 amount);
    event JobExpired(uint256 indexed acpJobId, bytes32 indexed jobId, address indexed client, uint256 amount);

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
    error NotEvaluator(bytes32 jobId);
    error ZeroSlip(bytes32 jobId);
    error HookFailed(bytes4 selector);

    constructor(address token_, address treasury_, uint16 tollBps_, address evaluator_) EIP712("Countersign", "1") {
        if (token_ == address(0) || treasury_ == address(0) || evaluator_ == address(0)) revert ZeroAddress();
        if (tollBps_ > MAX_TOLL_BPS) revert TollTooHigh(tollBps_);
        token = IERC20(token_);
        treasury = treasury_;
        tollBps = tollBps_;
        evaluator = evaluator_;
        hook = address(new SlipHook(address(this), COMPLETE_SELECTOR));
    }

    /// @notice Open a job and lock `cs.amount` from the buyer. Anyone may submit the buyer's authorisation.
    function fund(bytes32 offerHash, Countersignature calldata cs) external nonReentrant returns (uint256 acpJobId) {
        if (cs.amount == 0) revert ZeroAmount();
        if (cs.buyer == address(0) || cs.payee == address(0)) revert ZeroAddress();
        if (cs.deadline <= block.timestamp) revert DeadlineInPast(cs.deadline);

        bytes32 jobId = jobIdFor(offerHash, cs.buyer, cs.payee, cs.amount, cs.deadline, cs.salt);
        if (_acpOf[jobId] != 0) revert JobExists(jobId);
        _checkCountersignature(cs, jobId);

        acpJobId = ++jobCounter;
        bytes memory fundData = abi.encode(offerHash);
        _hook(false, acpJobId, this.fund.selector, fundData);
        _pull(cs, jobId);

        _acpOf[jobId] = acpJobId;
        _jobs[acpJobId] = Job({
            acpJobId: acpJobId,
            client: cs.buyer,
            provider: cs.payee,
            evaluator: evaluator,
            description: offerHash,
            budget: cs.amount,
            expiredAt: cs.deadline,
            status: Status.Funded,
            hook: hook,
            deliverable: bytes32(0)
        });
        _hook(true, acpJobId, this.fund.selector, fundData);
        emit JobFunded(acpJobId, jobId, cs.buyer, cs.payee, cs.amount, cs.deadline);
    }

    /// @notice Settle a funded job. The evaluator submits the provider's Release signature.
    ///         The hook's afterAction on this selector emits SlipCommitted.
    function complete(bytes32 jobId, bytes32 slipHash, bytes calldata sellerSig) external nonReentrant {
        uint256 acpJobId = _acpOf[jobId];
        Job storage job = _jobs[acpJobId];
        if (acpJobId == 0 || job.status != Status.Funded) revert NotFunded(jobId);
        if (block.timestamp > job.expiredAt) revert DeadlinePassed(jobId, job.expiredAt);
        if (slipHash == bytes32(0)) revert ZeroSlip(jobId);
        if (msg.sender != evaluator) revert NotEvaluator(jobId);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, jobId, slipHash)));
        if (!SignatureChecker.isValidSignatureNow(job.provider, digest, sellerSig)) revert NotPayee(jobId);

        bytes memory submitData = abi.encode(slipHash, bytes(""));
        _hook(false, acpJobId, SUBMIT_SELECTOR, submitData);
        job.status = Status.Submitted;
        job.deliverable = slipHash;
        _hook(true, acpJobId, SUBMIT_SELECTOR, submitData);
        emit JobSubmitted(acpJobId, jobId, slipHash);

        bytes memory completeData = abi.encode(slipHash, abi.encode(jobId));
        _hook(false, acpJobId, COMPLETE_SELECTOR, completeData);

        uint256 amount = job.budget;
        uint256 toll = tollOf(amount);
        uint256 paid = amount - toll;
        address provider = job.provider;
        job.status = Status.Completed;
        token.safeTransfer(provider, paid);
        if (toll != 0) token.safeTransfer(treasury, toll);

        _hook(true, acpJobId, COMPLETE_SELECTOR, completeData);
        emit JobCompleted(acpJobId, jobId, slipHash);
        emit PaymentReleased(acpJobId, provider, paid, toll);
    }

    /// @notice The provider hands the budget back before settlement. The provider calls it,
    ///         or anyone submits it with the provider's Cancel signature.
    function reject(bytes32 jobId, bytes calldata sellerSig) external nonReentrant {
        uint256 acpJobId = _acpOf[jobId];
        Job storage job = _jobs[acpJobId];
        if (acpJobId == 0 || job.status != Status.Funded) revert NotFunded(jobId);
        if (msg.sender != job.provider) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, jobId)));
            if (!SignatureChecker.isValidSignatureNow(job.provider, digest, sellerSig)) revert NotPayee(jobId);
        }

        bytes memory rejectData = abi.encode(bytes32(0), abi.encode(jobId));
        _hook(false, acpJobId, this.reject.selector, rejectData);
        _refund(acpJobId, job, jobId, false);
        _hook(true, acpJobId, this.reject.selector, rejectData);
    }

    /// @notice Return the budget to the client once the deadline has passed. Not hooked.
    function claimRefund(bytes32 jobId) external nonReentrant {
        uint256 acpJobId = _acpOf[jobId];
        Job storage job = _jobs[acpJobId];
        if (acpJobId == 0 || (job.status != Status.Funded && job.status != Status.Submitted)) revert NotFunded(jobId);
        if (block.timestamp <= job.expiredAt) revert DeadlineNotReached(jobId, job.expiredAt);
        _refund(acpJobId, job, jobId, true);
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
        return _jobs[_acpOf[jobId]];
    }

    function statusOf(bytes32 jobId) external view returns (uint8) {
        return uint8(_jobs[_acpOf[jobId]].status);
    }

    function tollOf(uint256 amount) public view returns (uint256) {
        return (amount * tollBps) / 10_000;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _refund(uint256 acpJobId, Job storage job, bytes32 jobId, bool expired) private {
        job.status = expired ? Status.Expired : Status.Rejected;
        address client = job.client;
        uint256 amount = job.budget;
        token.safeTransfer(client, amount);
        if (expired) emit JobExpired(acpJobId, jobId, client, amount);
        else emit JobRejected(acpJobId, jobId, client, amount);
    }

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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC3009(address(token)).DOMAIN_SEPARATOR(), authHash));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, cs.v, cs.r, cs.s);
        if (err != ECDSA.RecoverError.NoError || signer != cs.buyer) revert CountersignatureMismatch(jobId);
    }

    function _pull(Countersignature calldata cs, bytes32 jobId) private {
        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            cs.buyer, address(this), cs.amount, cs.validAfter, cs.validBefore, jobId, cs.v, cs.r, cs.s
        );
        if (token.balanceOf(address(this)) - before != cs.amount) revert TransferShortfall(jobId);
    }

    function _hook(bool afterAction, uint256 acpJobId, bytes4 selector, bytes memory data) private {
        bytes4 action = afterAction ? IJobHook.afterAction.selector : IJobHook.beforeAction.selector;
        (bool ok, bytes memory ret) = hook.call{gas: HOOK_GAS_LIMIT}(abi.encodeWithSelector(action, acpJobId, selector, data));
        if (ok) return;
        if (ret.length == 0) revert HookFailed(selector);
        assembly {
            revert(add(ret, 0x20), mload(ret))
        }
    }
}
