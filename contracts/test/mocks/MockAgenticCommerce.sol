// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAgenticCommerce} from "../../src/IAgenticCommerce.sol";

/// @dev An in-memory ERC-8183 core for the adapter's tests. It keeps the reference role and
///      status rules, including the five-minute expiry floor, and can simulate a fee
///      (`skimBps`) or a core that refuses a late reject (`rejectReverts`).
contract MockAgenticCommerce is IAgenticCommerce {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public skimBps;
    bool public rejectReverts;

    uint256 private _nextId = 1;
    mapping(uint256 jobId => Job) private _jobs;

    error ExpiryTooShort(uint256 expiredAt);
    error NotClient(uint256 jobId);
    error NotProvider(uint256 jobId);
    error NotEvaluator(uint256 jobId);
    error WrongStatus(uint256 jobId, JobStatus status);
    error RefundNotYetAvailable(uint256 jobId, uint256 expiredAt);
    error RejectRefused();

    constructor(address token_) {
        token = IERC20(token_);
    }

    function setSkimBps(uint256 bps) external {
        skimBps = bps;
    }

    function setRejectReverts(bool on) external {
        rejectReverts = on;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 id) {
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort(expiredAt);
        id = _nextId++;
        _jobs[id] = Job({
            id: id,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook
        });
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.provider) revert NotProvider(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus(jobId, job.status);
        job.budget = amount;
    }

    function fund(uint256 jobId, bytes calldata) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.client) revert NotClient(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus(jobId, job.status);
        job.status = JobStatus.Funded;
        token.safeTransferFrom(job.client, address(this), job.budget);
    }

    function submit(uint256 jobId, bytes32, bytes calldata) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.provider) revert NotProvider(jobId);
        if (job.status != JobStatus.Funded) revert WrongStatus(jobId, job.status);
        job.status = JobStatus.Submitted;
    }

    function complete(uint256 jobId, bytes32, bytes calldata) external {
        Job storage job = _jobs[jobId];
        if (msg.sender != job.evaluator) revert NotEvaluator(jobId);
        if (job.status != JobStatus.Submitted) revert WrongStatus(jobId, job.status);
        uint256 skim = (job.budget * skimBps) / 10_000;
        job.status = JobStatus.Completed;
        token.safeTransfer(job.provider, job.budget - skim);
    }

    function reject(uint256 jobId, bytes32, bytes calldata) external {
        if (rejectReverts) revert RejectRefused();
        Job storage job = _jobs[jobId];
        if (msg.sender != job.evaluator) revert NotEvaluator(jobId);
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert WrongStatus(jobId, job.status);
        }
        uint256 amount = job.budget;
        address client = job.client;
        job.status = JobStatus.Rejected;
        token.safeTransfer(client, amount);
    }

    function claimRefund(uint256 jobId) external {
        Job storage job = _jobs[jobId];
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert WrongStatus(jobId, job.status);
        }
        if (block.timestamp < job.expiredAt) revert RefundNotYetAvailable(jobId, job.expiredAt);
        uint256 amount = job.budget;
        address client = job.client;
        job.status = JobStatus.Expired;
        token.safeTransfer(client, amount);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }
}
