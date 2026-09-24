// Shapes the stable, documented v1 API responses (see /docs). The internal
// audit object can change; these fields shouldn't.

import { Interface } from "ethers";
import { rpcFor } from "./rpc";
import { NETS, type Net } from "./chain";
import { REVIEWER_LISTS_ABI, reviewerLists } from "./deployments";
import type { AgentAudit } from "./types";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const listsAbi = new Interface(REVIEWER_LISTS_ABI);

export function countedReviewers(a: AgentAudit): string[] {
  return a.reviewers
    .filter((r) => r.counted)
    .map((r) => r.address.toLowerCase())
    .sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
}

// What MonadTrust has published on-chain for this agent, if anything.
async function onchainList(net: Net, agentId: string) {
  const d = reviewerLists(net);
  if (!d.address || !d.publisher) return null;
  try {
    const raw = await rpcFor(net).ethCall(
      d.address,
      listsAbi.encodeFunctionData("getList", [d.publisher, BigInt(agentId)])
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

export async function agentV1(a: AgentAudit, net: Net, origin: string) {
  const d = reviewerLists(net);
  return {
    agentId: a.agent.agentId,
    network: net,
    chainId: NETS[net].chainId,
    name: a.agent.card?.name ?? null,
    owner: a.agent.owner,
    verdict: a.verdict,
    headline: a.headline,
    checkedAt: { block: a.asOf.block, timestamp: a.asOf.timestamp },
    auditHash: a.auditHash,
    reviewers: {
      total: a.totals.reviewers,
      read: a.reviewers.length,
      counted: a.totals.counted,
      struck: a.totals.struck,
    },
    countedReviewers: countedReviewers(a),
    ratings: a.tags.map((t) => ({
      tag: t.tag,
      listed: { average: t.listed.average, reviews: t.listed.reviews },
      counted: { average: t.counted.average, reviews: t.counted.reviews },
    })),
    onchain: {
      reviewerLists: d.address,
      publisher: d.publisher,
      list: await onchainList(net, a.agent.agentId),
    },
    report: `${origin}/agent/${a.agent.agentId}${net === "testnet" ? "?net=testnet" : ""}`,
  };
}
