// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @dev The ERC-8004 identity surface this repository uses, with the same EIP-712 wallet check.
contract MockIdentityRegistry is ERC721, EIP712 {
    bytes32 public constant AGENT_WALLET_SET_TYPEHASH = keccak256(
        "AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"
    );

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    mapping(uint256 agentId => string) private _agentUris;
    mapping(uint256 agentId => address) private _agentWallets;
    uint256 private _nextAgentId = 1;

    constructor() ERC721("ERC-8004 Agent", "AGENT") EIP712("ERC8004IdentityRegistry", "1") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextAgentId++;
        _agentUris[agentId] = agentURI;
        _agentWallets[agentId] = msg.sender;
        _mint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external {
        require(block.timestamp <= deadline, "signature expired");
        require(deadline <= block.timestamp + 5 minutes, "deadline too far");
        address owner = ownerOf(agentId);
        require(msg.sender == owner || isApprovedForAll(owner, msg.sender), "not owner or operator");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(AGENT_WALLET_SET_TYPEHASH, agentId, newWallet, owner, deadline))
        );
        require(ECDSA.recover(digest, signature) == newWallet, "invalid wallet signature");
        _agentWallets[agentId] = newWallet;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        ownerOf(agentId);
        return _agentWallets[agentId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return _agentUris[tokenId];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
