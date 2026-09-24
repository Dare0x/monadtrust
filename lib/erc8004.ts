// Reads the canonical ERC-8004 registries on Monad testnet.
//
// Everything here uses view functions only, so it works on the free public RPC
// (which caps eth_getLogs at 100 blocks and so can't scan event history):
//   IdentityRegistry.ownerOf / tokenURI / getAgentWallet
//   ReputationRegistry.readAllFeedback / getClients

import { Interface } from "ethers";
import { ERC8004 } from "./chain";
import { RpcClient, RpcRevertError } from "./rpc";
import type { AgentCard, AgentIdentity, FeedbackEntry } from "./types";

const identityAbi = new Interface([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

const reputationAbi = new Interface([
  "function getClients(uint256 agentId) view returns (address[])",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

async function callIdentity(rpc: RpcClient, fn: string, args: unknown[]) {
  const data = identityAbi.encodeFunctionData(fn, args);
  const raw = await rpc.ethCall(ERC8004.identityRegistry, data);
  return identityAbi.decodeFunctionResult(fn, raw);
}

async function callReputation(rpc: RpcClient, fn: string, args: unknown[]) {
  const data = reputationAbi.encodeFunctionData(fn, args);
  const raw = await rpc.ethCall(ERC8004.reputationRegistry, data);
  return reputationAbi.decodeFunctionResult(fn, raw);
}

/** True if the agent id has been minted (ownerOf does not revert). */
export async function agentExists(rpc: RpcClient, agentId: bigint): Promise<boolean> {
  try {
    await callIdentity(rpc, "ownerOf", [agentId]);
    return true;
  } catch (e) {
    if (e instanceof RpcRevertError) return false;
    throw e;
  }
}

export async function fetchAgentIdentity(rpc: RpcClient, agentId: bigint): Promise<AgentIdentity | null> {
  let owner: string;
  try {
    owner = (await callIdentity(rpc, "ownerOf", [agentId]))[0] as string;
  } catch (e) {
    if (e instanceof RpcRevertError) return null; // not registered
    throw e;
  }
  const [uri, wallet] = await Promise.all([
    callIdentity(rpc, "tokenURI", [agentId])
      .then((r) => r[0] as string)
      .catch(() => ""),
    callIdentity(rpc, "getAgentWallet", [agentId])
      .then((r) => r[0] as string)
      .catch(() => ZERO),
  ]);
  const card = uri ? await resolveAgentCard(uri) : null;
  return {
    agentId: agentId.toString(),
    owner: owner.toLowerCase(),
    agentWallet: wallet && wallet !== ZERO ? wallet.toLowerCase() : null,
    uri: uri || null,
    card,
  };
}

export async function fetchFeedback(rpc: RpcClient, agentId: bigint): Promise<FeedbackEntry[]> {
  const r = await callReputation(rpc, "readAllFeedback", [agentId, [], "", "", false]);
  const clients = r[0] as string[];
  const indexes = r[1] as bigint[];
  const values = r[2] as bigint[];
  const decimals = r[3] as bigint[];
  const tag1s = r[4] as string[];
  const tag2s = r[5] as string[];
  const out: FeedbackEntry[] = [];
  for (let i = 0; i < clients.length; i++) {
    const dec = Number(decimals[i]);
    out.push({
      client: clients[i].toLowerCase(),
      index: Number(indexes[i]),
      rawValue: values[i].toString(),
      decimals: dec,
      value: Number(values[i]) / 10 ** dec,
      tag1: tag1s[i] ?? "",
      tag2: tag2s[i] ?? "",
    });
  }
  return out;
}

export function encodeGetSummary(agentId: string, clients: string[], tag1: string): string {
  return reputationAbi.encodeFunctionData("getSummary", [BigInt(agentId), clients, tag1, ""]);
}

/**
 * Highest registered agent id. Ids are minted sequentially from 0, so we
 * gallop up in powers of two until ownerOf reverts, then binary-search.
 */
export async function findLatestAgentId(rpc: RpcClient): Promise<bigint | null> {
  let lo: bigint;
  if (await agentExists(rpc, BigInt(0))) lo = BigInt(0);
  else if (await agentExists(rpc, BigInt(1))) lo = BigInt(1);
  else return null;
  let hi = lo * BigInt(2) + BigInt(1);
  while (await agentExists(rpc, hi)) {
    lo = hi;
    hi = hi * BigInt(2);
    if (hi > BigInt(1) << BigInt(40)) break;
  }
  // Invariant: exists(lo), !exists(hi)
  while (hi - lo > BigInt(1)) {
    const mid = (lo + hi) / BigInt(2);
    if (await agentExists(rpc, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---- Agent card (the registration file behind tokenURI) -------------------

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function isSafeHttpsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    // Refuse raw IPs and local names so a malicious agent URI can't make our
    // server fetch internal addresses.
    if (/^[\d.]+$/.test(host) || host.includes(":") || host === "localhost" || host.endsWith(".local")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function pickCard(json: unknown): AgentCard | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const card: AgentCard = {
    name: str(j.name, 80),
    description: str(j.description, 400),
    image: str(j.image, 500),
  };
  return card.name || card.description ? card : null;
}

export async function resolveAgentCard(uri: string): Promise<AgentCard | null> {
  try {
    if (uri.startsWith("data:")) {
      const comma = uri.indexOf(",");
      if (comma < 0) return null;
      const meta = uri.slice(5, comma);
      const payload = uri.slice(comma + 1);
      const text = meta.includes(";base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return pickCard(JSON.parse(text));
    }
    let url = uri;
    if (uri.startsWith("ipfs://")) url = IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, "");
    if (!isSafeHttpsUrl(url)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow", cache: "no-store" });
      if (!res.ok) return null;
      const text = (await res.text()).slice(0, 100_000);
      return pickCard(JSON.parse(text));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
