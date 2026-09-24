// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The part of the ERC-8004 Reputation Registry this contract reads.
interface IReputationRegistry {
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}

/// @title ReviewerLists
/// @notice ERC-8004's getSummary() only totals reviews from a list of reviewers
/// the caller trusts, and leaves building that list to others. Here anyone can
/// publish that list for an agent. Consumers choose which publishers they
/// trust and get the filtered rating in one call.
///
/// A publisher's list is only as good as the publisher. MonadTrust publishes
/// lists produced by an open, deterministic audit (github.com/Dare0x/monadtrust)
/// and records the audit's hash and source block, so anyone can re-run the
/// audit at that block and check the list matches.
contract ReviewerLists {
    IReputationRegistry public immutable reputation;

    /// Keeps publish() and getSummary() within sensible gas.
    uint256 public constant MAX_CLIENTS = 200;

    struct List {
        address[] clients;
        bytes32 auditHash;
        uint64 sourceBlock;
        uint64 publishedAt;
    }

    mapping(address publisher => mapping(uint256 agentId => List)) private lists;

    event ListPublished(
        address indexed publisher,
        uint256 indexed agentId,
        bytes32 auditHash,
        uint64 sourceBlock,
        uint256 clientCount
    );

    error TooManyClients();
    error ClientsNotSorted();

    constructor(address reputationRegistry) {
        reputation = IReputationRegistry(reputationRegistry);
    }

    /// @notice Publish (or replace) your list of counted reviewers for an agent.
    /// @param clients Reviewer addresses, strictly ascending (so no duplicates).
    ///        An empty list is a valid answer: no reviewer holds up.
    /// @param auditHash Hash of the audit that produced this list.
    /// @param sourceBlock Block the audit read the chain at.
    function publish(uint256 agentId, address[] calldata clients, bytes32 auditHash, uint64 sourceBlock) external {
        if (clients.length > MAX_CLIENTS) revert TooManyClients();
        for (uint256 i = 1; i < clients.length; i++) {
            if (clients[i] <= clients[i - 1]) revert ClientsNotSorted();
        }
        List storage l = lists[msg.sender][agentId];
        l.clients = clients;
        l.auditHash = auditHash;
        l.sourceBlock = sourceBlock;
        l.publishedAt = uint64(block.timestamp);
        emit ListPublished(msg.sender, agentId, auditHash, sourceBlock, clients.length);
    }

    /// @notice A publisher's list for an agent. publishedAt is 0 if they never published one.
    function getList(address publisher, uint256 agentId)
        external
        view
        returns (address[] memory clients, bytes32 auditHash, uint64 sourceBlock, uint64 publishedAt)
    {
        List storage l = lists[publisher][agentId];
        return (l.clients, l.auditHash, l.sourceBlock, l.publishedAt);
    }

    /// @notice The agent's ERC-8004 summary counting only the publisher's reviewers.
    /// Returns zeros when the list is empty or was never published (check getList
    /// to tell those apart).
    function getSummary(address publisher, uint256 agentId, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        address[] memory clients = lists[publisher][agentId].clients;
        if (clients.length == 0) return (0, 0, 0);
        return reputation.getSummary(agentId, clients, tag1, tag2);
    }
}
