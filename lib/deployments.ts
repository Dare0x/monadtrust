// Where MonadTrust's ReviewerLists contract lives, and the address MonadTrust
// publishes its own lists from. Written by scripts/deploy-reviewer-lists.ts.

import reviewerLists from "../contracts/reviewer-lists.json";

export const REVIEWER_LISTS = {
  address: (reviewerLists.address as string | null) ?? null,
  publisher: (reviewerLists.publisher as string | null) ?? null,
  abi: [
    "function publish(uint256 agentId, address[] clients, bytes32 auditHash, uint64 sourceBlock)",
    "function getList(address publisher, uint256 agentId) view returns (address[] clients, bytes32 auditHash, uint64 sourceBlock, uint64 publishedAt)",
    "function getSummary(address publisher, uint256 agentId, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
    "event ListPublished(address indexed publisher, uint256 indexed agentId, bytes32 auditHash, uint64 sourceBlock, uint256 clientCount)",
  ],
};
