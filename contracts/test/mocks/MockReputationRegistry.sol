// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The ERC-8004 feedback surface this repository uses. The client is msg.sender.
contract MockReputationRegistry {
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    mapping(uint256 agentId => mapping(address client => uint64)) private _feedbackIndex;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        _give(
            agentId,
            Feedback({
                value: value,
                valueDecimals: valueDecimals,
                tag1: tag1,
                tag2: tag2,
                endpoint: endpoint,
                feedbackURI: feedbackURI,
                feedbackHash: feedbackHash
            })
        );
    }

    function feedbackIndex(uint256 agentId, address client) external view returns (uint64) {
        return _feedbackIndex[agentId][client];
    }

    function _give(uint256 agentId, Feedback memory feedback) private {
        uint64 nextIndex = _feedbackIndex[agentId][msg.sender]++;
        emit NewFeedback(
            agentId,
            msg.sender,
            nextIndex,
            feedback.value,
            feedback.valueDecimals,
            feedback.tag1,
            feedback.tag1,
            feedback.tag2,
            feedback.endpoint,
            feedback.feedbackURI,
            feedback.feedbackHash
        );
    }
}
