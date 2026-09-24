// Glue between the chain readers and the deterministic audit engine.

import { RpcClient } from "./rpc";
import { WINDOW_BLOCKS, WINDOW_DAYS } from "./chain";
import { fetchAgentIdentity, fetchFeedback, findLatestAgentId, resolveAgentCard } from "./erc8004";
import { fetchReviewerSnapshots, readChainContext } from "./reviewers";
import { auditAgent } from "./audit";
import type { AgentAudit, AgentListing } from "./types";
import { Interface } from "ethers";
import { ERC8004 } from "./chain";
import { multicall } from "./multicall";
import snapshotFile from "../data/agents-snapshot.json";
import savedAuditsFile from "../data/audits-snapshot.json";

// Reading each reviewer takes ~25 small RPC reads. Cap how many we read in one
// request so a heavily reviewed agent still answers in time on a free RPC.
export const MAX_REVIEWERS = Number(process.env.MAX_REVIEWERS || 60);

export class AgentNotFoundError extends Error {}

const auditCache = new Map<string, { at: number; value: AgentAudit }>();
const auditRefresh = new Map<string, Promise<AgentAudit>>();
const AUDIT_TTL_MS = 90_000;

// Audits of the most reviewed agents, saved by `npm run snapshot`. A full
// audit makes a few hundred rate-limited reads (about 25s on the free RPC), so
// these open instantly and are re-read in the background.
const SAVED_AUDITS = savedAuditsFile as unknown as Record<string, AgentAudit>;

function refreshAudit(agentIdStr: string): Promise<AgentAudit> {
  let p = auditRefresh.get(agentIdStr);
  if (!p) {
    p = auditLive(agentIdStr).finally(() => auditRefresh.delete(agentIdStr));
    auditRefresh.set(agentIdStr, p);
  }
  return p;
}

export async function runAudit(agentIdStr: string): Promise<AgentAudit> {
  const cached = auditCache.get(agentIdStr);
  if (cached && Date.now() - cached.at < AUDIT_TTL_MS) return cached.value;
  const stale = cached?.value ?? SAVED_AUDITS[agentIdStr];
  if (stale) {
    refreshAudit(agentIdStr).catch(() => {});
    return stale;
  }
  return refreshAudit(agentIdStr);
}

// Every audit we have on hand: saved ones, overlaid with fresher live ones.
export function knownAudits(): Map<string, AgentAudit> {
  const all = new Map<string, AgentAudit>(Object.entries(SAVED_AUDITS));
  for (const [id, c] of auditCache) all.set(id, c.value);
  return all;
}

// The clearest case of stuffed reviews we know of right now, for the homepage.
export function featuredCatch(): AgentAudit | null {
  let best: AgentAudit | null = null;
  for (const a of knownAudits().values()) {
    if (a.verdict !== "inflated") continue;
    if (!best || a.totals.struck > best.totals.struck || (a.totals.struck === best.totals.struck && a.asOf.block > best.asOf.block)) best = a;
  }
  return best;
}

// Always reads the chain.
export async function auditLive(agentIdStr: string): Promise<AgentAudit> {
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
  if (audit.onchainCheck) {
    // Make the call we tell readers to make, and show what the registry said.
    audit.onchainCheck.registryAnswer = await rpc
      .ethCall(ERC8004.reputationRegistry, audit.onchainCheck.calldata)
      .then((raw) => {
        const [count, value, decimals] = summaryAbi.decodeFunctionResult("getSummary", raw);
        return { count: Number(count), value: Number(value), decimals: Number(decimals) };
      })
      .catch(() => null);
  }
  auditCache.set(agentIdStr, { at: Date.now(), value: audit });
  return audit;
}

// ---- Discovery -------------------------------------------------------------

const identityAbi = new Interface(["function tokenURI(uint256) view returns (string)", "function ownerOf(uint256) view returns (address)"]);
const reputationAbi = new Interface(["function getClients(uint256) view returns (address[])"]);
const summaryAbi = new Interface([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export interface AgentDirectory {
  latestAgentId: string | null;
  scanned: number;
  agents: AgentListing[];
  // When this list was read from the chain (ISO time).
  updatedAt: string;
}

// A saved copy of the list (npm run snapshot), so a cold server answers at
// once instead of making the first visitor wait for a full registry scan.
const SNAPSHOT = snapshotFile as AgentDirectory;

let listCache: { at: number; value: AgentDirectory } | null = null;
let refreshing: Promise<AgentDirectory> | null = null;
const LIST_TTL_MS = 10 * 60_000;
const SCAN_SPAN = Number(process.env.SCAN_SPAN || 1500);

function refreshList(): Promise<AgentDirectory> {
  refreshing ??= scanReviewedAgents()
    .then((value) => {
      listCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Serve whatever we have straight away and refresh it in the background.
// Only wait on the chain when there is nothing at all to show.
export async function listReviewedAgents(): Promise<AgentDirectory> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.value;
  const stale = listCache?.value ?? (SNAPSHOT.agents.length ? SNAPSHOT : null);
  if (stale) {
    refreshList().catch(() => {});
    return stale;
  }
  return refreshList();
}

export async function scanReviewedAgents(): Promise<AgentDirectory> {
  const rpc = new RpcClient();
  const latest = await findLatestAgentId(rpc);
  if (latest === null) return { latestAgentId: null, scanned: 0, agents: [], updatedAt: new Date().toISOString() };
  const from = latest - BigInt(SCAN_SPAN) + BigInt(1) > BigInt(0) ? latest - BigInt(SCAN_SPAN) + BigInt(1) : BigInt(0);
  const ids: bigint[] = [];
  for (let id = from; id <= latest; id++) ids.push(id);

  // One multicall per 200 agents. If the chain can't be read this throws, and
  // the last good list stays up, rather than a failed read passing for "no reviews".
  const countData = await multicall(
    rpc,
    ids.map((id) => ({ target: ERC8004.reputationRegistry, data: reputationAbi.encodeFunctionData("getClients", [id]) }))
  );
  const reviewed = ids
    .map((id, i) => {
      const raw = countData[i];
      const reviewers = raw ? (reputationAbi.decodeFunctionResult("getClients", raw)[0] as string[]).length : 0;
      return { id, reviewers };
    })
    .filter((x) => x.reviewers > 0)
    .sort((a, b) => b.reviewers - a.reviewers || Number(b.id - a.id))
    .slice(0, 30);

  const idData = await multicall(
    rpc,
    reviewed.flatMap(({ id }) => [
      { target: ERC8004.identityRegistry, data: identityAbi.encodeFunctionData("tokenURI", [id]) },
      { target: ERC8004.identityRegistry, data: identityAbi.encodeFunctionData("ownerOf", [id]) },
    ])
  );
  const agents: AgentListing[] = await Promise.all(
    reviewed.map(async ({ id, reviewers }, i) => {
      const uriRaw = idData[2 * i];
      const ownerRaw = idData[2 * i + 1];
      const uri = uriRaw ? (identityAbi.decodeFunctionResult("tokenURI", uriRaw)[0] as string) : "";
      const owner = ownerRaw ? (identityAbi.decodeFunctionResult("ownerOf", ownerRaw)[0] as string).toLowerCase() : null;
      const card = uri ? await resolveAgentCard(uri) : null;
      return { agentId: id.toString(), reviewers, name: card?.name ?? null, owner };
    })
  );

  return { latestAgentId: latest.toString(), scanned: ids.length, agents, updatedAt: new Date().toISOString() };
}
