// Glue between the chain readers and the deterministic audit engine.

import { RpcClient } from "./rpc";
import { WINDOW_BLOCKS, WINDOW_DAYS } from "./chain";
import { fetchAgentIdentity, fetchClientCount, fetchFeedback, findLatestAgentId, resolveAgentCard } from "./erc8004";
import { fetchReviewerSnapshots, readChainContext } from "./reviewers";
import { auditAgent } from "./audit";
import type { AgentAudit, AgentListing } from "./types";
import { Interface } from "ethers";
import { ERC8004 } from "./chain";

// Reading each reviewer takes ~25 small RPC reads. Cap how many we read in one
// request so a heavily reviewed agent still answers in time on a free RPC.
export const MAX_REVIEWERS = Number(process.env.MAX_REVIEWERS || 60);

export class AgentNotFoundError extends Error {}

const auditCache = new Map<string, { at: number; value: AgentAudit }>();
const AUDIT_TTL_MS = 90_000;

export async function runAudit(agentIdStr: string): Promise<AgentAudit> {
  const cached = auditCache.get(agentIdStr);
  if (cached && Date.now() - cached.at < AUDIT_TTL_MS) return cached.value;

  const rpc = new RpcClient();
  const agentId = BigInt(agentIdStr);
  const [ctx, agent, feedback] = await Promise.all([
    readChainContext(rpc, WINDOW_BLOCKS),
    fetchAgentIdentity(rpc, agentId),
    fetchFeedback(rpc, agentId).catch((e) => {
      // readAllFeedback reverts for unknown agents on some deployments.
      if (String(e?.message ?? "").toLowerCase().includes("revert")) return [];
      throw e;
    }),
  ]);
  if (!agent) throw new AgentNotFoundError(`Agent ${agentIdStr} is not registered on Monad testnet.`);

  // Busiest reviewers first, so the cap drops the least influential ones.
  const perClient = new Map<string, number>();
  for (const f of feedback) perClient.set(f.client, (perClient.get(f.client) ?? 0) + 1);
  const clients = [...perClient.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c]) => c);
  const toRead = clients.slice(0, MAX_REVIEWERS);
  const skipped = clients.slice(MAX_REVIEWERS);

  const { snapshots, failed } = await fetchReviewerSnapshots(rpc, toRead, ctx);

  const audit = auditAgent({
    agent,
    feedback,
    snapshots,
    notAnalyzed: [...failed, ...skipped],
    asOf: {
      block: ctx.latestBlock,
      timestamp: ctx.latestTimestamp,
      windowDays: WINDOW_DAYS,
      windowStartBlock: ctx.windowStart,
    },
  });
  auditCache.set(agentIdStr, { at: Date.now(), value: audit });
  return audit;
}

// ---- Discovery -------------------------------------------------------------

const identityAbi = new Interface(["function tokenURI(uint256) view returns (string)", "function ownerOf(uint256) view returns (address)"]);

let listCache: { at: number; value: { latestAgentId: string | null; scanned: number; agents: AgentListing[] } } | null = null;
const LIST_TTL_MS = 10 * 60_000;
const SCAN_SPAN = Number(process.env.SCAN_SPAN || 1500);

export async function listReviewedAgents() {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.value;
  const rpc = new RpcClient();
  const latest = await findLatestAgentId(rpc);
  if (latest === null) {
    const empty = { latestAgentId: null, scanned: 0, agents: [] as AgentListing[] };
    listCache = { at: Date.now(), value: empty };
    return empty;
  }
  const from = latest - BigInt(SCAN_SPAN) + BigInt(1) > BigInt(0) ? latest - BigInt(SCAN_SPAN) + BigInt(1) : BigInt(0);
  const ids: bigint[] = [];
  for (let id = from; id <= latest; id++) ids.push(id);

  const counts = await Promise.all(ids.map((id) => fetchClientCount(rpc, id).catch(() => 0)));
  const reviewed = ids
    .map((id, i) => ({ id, reviewers: counts[i] }))
    .filter((x) => x.reviewers > 0)
    .sort((a, b) => b.reviewers - a.reviewers || Number(b.id - a.id))
    .slice(0, 30);

  const agents: AgentListing[] = await Promise.all(
    reviewed.map(async ({ id, reviewers }) => {
      const [uri, owner] = await Promise.all([
        rpc
          .ethCall(ERC8004.identityRegistry, identityAbi.encodeFunctionData("tokenURI", [id]))
          .then((raw) => identityAbi.decodeFunctionResult("tokenURI", raw)[0] as string)
          .catch(() => ""),
        rpc
          .ethCall(ERC8004.identityRegistry, identityAbi.encodeFunctionData("ownerOf", [id]))
          .then((raw) => (identityAbi.decodeFunctionResult("ownerOf", raw)[0] as string).toLowerCase())
          .catch(() => null),
      ]);
      const card = uri ? await resolveAgentCard(uri) : null;
      return { agentId: id.toString(), reviewers, name: card?.name ?? null, owner };
    })
  );

  const value = { latestAgentId: latest.toString(), scanned: ids.length, agents };
  listCache = { at: Date.now(), value };
  return value;
}
