// Shapes the stable, documented v1 API responses (see /docs). The internal
// audit object can change; these fields shouldn't.

import { Interface } from "ethers";
import { RpcClient } from "./rpc";
import { REVIEWER_LISTS } from "./deployments";
import type { AgentAudit } from "./types";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const listsAbi = new Interface(REVIEWER_LISTS.abi);

export function countedReviewers(a: AgentAudit): string[] {
  return a.reviewers
    .filter((r) => r.counted)
    .map((r) => r.address.toLowerCase())
    .sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
}

// What MonadTrust has published on-chain for this agent, if anything.
async function onchainList(agentId: string) {
  if (!REVIEWER_LISTS.address || !REVIEWER_LISTS.publisher) return null;
  try {
    const raw = await new RpcClient().ethCall(
      REVIEWER_LISTS.address,
      listsAbi.encodeFunctionData("getList", [REVIEWER_LISTS.publisher, BigInt(agentId)])
    );
    const [clients, auditHash, sourceBlock, publishedAt] = listsAbi.decodeFunctionResult("getList", raw);
    if (Number(publishedAt) === 0) return { published: false as const };
    return {
      published: true as const,
      reviewers: (clients as string[]).length,
      auditHash: auditHash as string,
      sourceBlock: Number(sourceBlock),
      publishedAt: Number(publishedAt),
    };
  } catch {
    return null;
  }
}

export async function agentV1(a: AgentAudit, origin: string) {
  return {
    agentId: a.agent.agentId,
    chainId: 10143,
    name: a.agent.card?.name ?? null,
    owner: a.agent.owner,
    verdict: a.verdict,
    headline: a.headline,
    checkedAt: { block: a.asOf.block, timestamp: a.asOf.timestamp },
    auditHash: a.auditHash,
    reviewers: { total: a.totals.reviewers, counted: a.totals.counted, struck: a.totals.struck },
    countedReviewers: countedReviewers(a),
    ratings: a.tags.map((t) => ({
      tag: t.tag,
      listed: { average: t.listed.average, reviews: t.listed.reviews },
      counted: { average: t.counted.average, reviews: t.counted.reviews },
    })),
    onchain: {
      reviewerLists: REVIEWER_LISTS.address,
      publisher: REVIEWER_LISTS.publisher,
      list: await onchainList(a.agent.agentId),
    },
    report: `${origin}/agent/${a.agent.agentId}`,
  };
}
