// Glue between the chain readers and the deterministic audit engine.

import { rpcFor } from "./rpc";
import { DEFAULT_NET, NETS, type Net, windowDays } from "./chain";
import { fetchAgentIdentity, fetchFeedback, findLatestAgentId, resolveAgentCard } from "./erc8004";
import { fetchReviewerSnapshots, readChainContext } from "./reviewers";
import { auditAgent } from "./audit";
import type { AgentAudit, AgentListing } from "./types";
import { Interface } from "ethers";
import { multicall } from "./multicall";
import snapshotFile from "../data/agents-snapshot.json";
import savedAuditsFile from "../data/audits-snapshot.json";

// Reading each reviewer takes ~25 small RPC reads. Cap how many we read in one
// request so a heavily reviewed agent still answers in time on a free RPC.
// Past the cap we read an even sample across the agent's reviewers.
export const MAX_REVIEWERS = Number(process.env.MAX_REVIEWERS || 60);

const key = (net: Net, id: string) => `${net}:${id}`;

export class AgentNotFoundError extends Error {}

const auditCache = new Map<string, { at: number; value: AgentAudit }>();
const auditRefresh = new Map<string, Promise<AgentAudit>>();
const AUDIT_TTL_MS = 90_000;

// Audits of the most reviewed agents, saved by `npm run snapshot`. A full
// audit makes a few hundred rate-limited reads (about 25s on the free RPC), so
// these open instantly and are re-read in the background.
const SAVED_AUDITS = savedAuditsFile as unknown as Partial<Record<Net, Record<string, AgentAudit>>>;

function refreshAudit(agentIdStr: string, net: Net): Promise<AgentAudit> {
  const k = key(net, agentIdStr);
  let p = auditRefresh.get(k);
  if (!p) {
    p = auditLive(agentIdStr, net).finally(() => auditRefresh.delete(k));
    auditRefresh.set(k, p);
  }
  return p;
}

export async function runAudit(agentIdStr: string, net: Net = DEFAULT_NET): Promise<AgentAudit> {
  const cached = auditCache.get(key(net, agentIdStr));
  if (cached && Date.now() - cached.at < AUDIT_TTL_MS) return cached.value;
  const stale = cached?.value ?? SAVED_AUDITS[net]?.[agentIdStr];
  if (stale) {
    refreshAudit(agentIdStr, net).catch(() => {});
    return stale;
  }
  return refreshAudit(agentIdStr, net);
}

// Every audit on hand for a network: saved ones, overlaid with fresher live ones.
export function knownAudits(net: Net = DEFAULT_NET): Map<string, AgentAudit> {
  const all = new Map<string, AgentAudit>(Object.entries(SAVED_AUDITS[net] ?? {}));
  for (const [k, c] of auditCache) if (k.startsWith(net + ":")) all.set(k.slice(net.length + 1), c.value);
  return all;
}

// The clearest case of stuffed reviews we know of right now, for the homepage.
export function featuredCatch(net: Net = DEFAULT_NET): AgentAudit | null {
  let best: AgentAudit | null = null;
  for (const a of knownAudits(net).values()) {
    if (a.verdict !== "inflated") continue;
    if (!best || a.totals.struck > best.totals.struck || (a.totals.struck === best.totals.struck && a.asOf.block > best.asOf.block)) best = a;
  }
  return best;
}

// Always reads the chain.
export async function auditLive(agentIdStr: string, net: Net = DEFAULT_NET): Promise<AgentAudit> {
  const rpc = rpcFor(net);
  const cfg = NETS[net];
  const agentId = BigInt(agentIdStr);
  const [ctx, agent, feedback] = await Promise.all([
    readChainContext(rpc, cfg.windowBlocks),
    fetchAgentIdentity(rpc, agentId),
    fetchFeedback(rpc, agentId).catch((e) => {
      // readAllFeedback reverts for unknown agents on some deployments.
      if (String(e?.message ?? "").toLowerCase().includes("revert")) return [];
      throw e;
    }),
  ]);
  if (!agent) throw new AgentNotFoundError(`Agent ${agentIdStr} is not registered on ${cfg.name}.`);

  // Reviewers in the order they first reviewed. Within the cap, read them all;
  // past it, read an even sample across that order so every period is covered.
  const clients = [...new Set(feedback.map((f) => f.client))];
  const pick = new Set<number>();
  if (clients.length <= MAX_REVIEWERS) clients.forEach((_, i) => pick.add(i));
  else for (let i = 0; i < MAX_REVIEWERS; i++) pick.add(Math.round((i * (clients.length - 1)) / (MAX_REVIEWERS - 1)));
  const toRead = clients.filter((_, i) => pick.has(i));
  const skipped = clients.filter((_, i) => !pick.has(i));

  const { snapshots, failed } = await fetchReviewerSnapshots(rpc, toRead, ctx);

  const audit = auditAgent({
    agent,
    feedback,
    snapshots,
    notAnalyzed: [...failed, ...skipped],
    net,
    asOf: {
      block: ctx.latestBlock,
      timestamp: ctx.latestTimestamp,
      windowDays: windowDays(net),
      windowStartBlock: ctx.windowStart,
    },
  });
  if (audit.onchainCheck) {
    // Make the call we tell readers to make, and show what the registry said.
    audit.onchainCheck.registryAnswer = await rpc
      .ethCall(cfg.reputationRegistry, audit.onchainCheck.calldata)
      .then((raw) => {
        const [count, value, decimals] = summaryAbi.decodeFunctionResult("getSummary", raw);
        return { count: Number(count), value: Number(value), decimals: Number(decimals) };
      })
      .catch(() => null);
  }
  auditCache.set(key(net, agentIdStr), { at: Date.now(), value: audit });
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
const SNAPSHOT = snapshotFile as unknown as Partial<Record<Net, AgentDirectory>>;

const listCache = new Map<Net, { at: number; value: AgentDirectory }>();
const refreshing = new Map<Net, Promise<AgentDirectory>>();
const LIST_TTL_MS = 10 * 60_000;

function refreshList(net: Net): Promise<AgentDirectory> {
  let p = refreshing.get(net);
  if (!p) {
    p = scanReviewedAgents(net)
      .then((value) => {
        listCache.set(net, { at: Date.now(), value });
        return value;
      })
      .finally(() => refreshing.delete(net));
    refreshing.set(net, p);
  }
  return p;
}

// Serve whatever we have straight away and refresh it in the background.
// Only wait on the chain when there is nothing at all to show.
export async function listReviewedAgents(net: Net = DEFAULT_NET): Promise<AgentDirectory> {
  const cached = listCache.get(net);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.value;
  const saved = SNAPSHOT[net];
  const stale = cached?.value ?? (saved?.agents?.length ? saved : null);
  if (stale) {
    refreshList(net).catch(() => {});
    return stale;
  }
  return refreshList(net);
}

export async function scanReviewedAgents(net: Net = DEFAULT_NET): Promise<AgentDirectory> {
  const rpc = rpcFor(net);
  const cfg = NETS[net];
  const span = BigInt(Number(process.env.SCAN_SPAN || cfg.scanSpan));
  const latest = await findLatestAgentId(rpc);
  if (latest === null) return { latestAgentId: null, scanned: 0, agents: [], updatedAt: new Date().toISOString() };
  const from = latest - span + BigInt(1) > BigInt(0) ? latest - span + BigInt(1) : BigInt(0);
  const ids: bigint[] = [];
  for (let id = from; id <= latest; id++) ids.push(id);

  // One multicall per 100 agents. If the chain can't be read this throws, and
  // the last good list stays up, rather than a failed read passing for "no reviews".
  const countData = await multicall(
    rpc,
    ids.map((id) => ({ target: cfg.reputationRegistry, data: reputationAbi.encodeFunctionData("getClients", [id]) })),
    100
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
      { target: cfg.identityRegistry, data: identityAbi.encodeFunctionData("tokenURI", [id]) },
      { target: cfg.identityRegistry, data: identityAbi.encodeFunctionData("ownerOf", [id]) },
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
