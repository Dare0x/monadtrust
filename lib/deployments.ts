// Where MonadTrust's ReviewerLists contract lives on each network, and the
// address MonadTrust publishes its own lists from. Written by
// scripts/deploy-reviewer-lists.ts.

import deployments from "../contracts/reviewer-lists.json";
import type { Net } from "./chain";

type Deployment = { address: string | null; publisher: string | null };
const byNet = deployments as unknown as Record<Net, Deployment>;

export const REVIEWER_LISTS_ABI = [
  "function publish(uint256 agentId, address[] clients, bytes32 auditHash, uint64 sourceBlock)",
  "function getList(address publisher, uint256 agentId) view returns (address[] clients, bytes32 auditHash, uint64 sourceBlock, uint64 publishedAt)",
  "function getSummary(address publisher, uint256 agentId, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "event ListPublished(address indexed publisher, uint256 indexed agentId, bytes32 auditHash, uint64 sourceBlock, uint256 clientCount)",
];

export function reviewerLists(net: Net): Deployment {
  return { address: byNet[net]?.address ?? null, publisher: byNet[net]?.publisher ?? null };
}
