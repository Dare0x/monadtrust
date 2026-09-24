// MonadTrust review audit — deterministic engine.
//
// ERC-8004 lets any wallet review any agent. The standard itself warns that
// totals across all reviewers are open to Sybil/spam attacks, and its
// getSummary() refuses to run unless the caller supplies the list of reviewers
// to count. It leaves open who decides that list. This file decides it, using
// only public chain facts, with rules anyone can read and re-run:
//
//   1. Score each reviewer wallet on age, activity of its own, and balance.
//   2. Halve the score of wallets that were created in a burst together.
//   3. Count a reviewer only if its score clears the bar.
//   4. Recompute the rating from counted reviewers only — the same number
//      getSummary() returns when given that list.
//
// No model is involved, and nothing here uses the clock: time comes from the
// block we read, so the same block always gives the same audit.

import { keccak256, toUtf8Bytes } from "ethers";
import { NETS, type Net } from "./chain";
import { encodeGetSummary } from "./erc8004";
import type {
  FootprintGroup,
  AgentAudit,
  AgentIdentity,
  AuditVerdict,
  BurstCluster,
  FeedbackEntry,
  ReviewerFlag,
  ReviewerSnapshot,
  ReviewerVerdict,
  TagSummary,
} from "./types";

export const RULES = {
  countThreshold: 40, // credibility needed for a reviewer to count
  burstWindowMinutes: 30, // first transactions this close together form a burst
  burstMinSize: 3, // wallets needed to call it a burst
  ageSaturationDays: 14, // age score reaches 100 at this many days
  weights: { age: 0.45, activity: 0.4, balance: 0.15 },
} as const;

const DAY = 86_400;

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function plural(n: number, one: string, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return plural(Math.max(1, Math.round(seconds)), "second");
  const m = Math.round(seconds / 60);
  if (m < 90) return plural(m, "minute");
  const h = Math.round(seconds / 3600);
  if (h < 48) return plural(h, "hour");
  return plural(Math.round(seconds / DAY), "day");
}

/**
 * Groups reviewers whose first transaction falls inside the same short window.
 * Greedy from the earliest, so the result is unique for a given input.
 */
/** Groups of reviewers with identical non-zero balance (to the wei) and transaction count. */
export function findFootprints(snaps: ReviewerSnapshot[]): FootprintGroup[] {
  const groups = new Map<string, ReviewerSnapshot[]>();
  for (const s of snaps) {
    if (s.isContract || !s.balanceWei || s.balanceWei === "0" || s.txCount === 0) continue;
    const k = `${s.balanceWei}|${s.txCount}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= RULES.burstMinSize)
    .map((g) => ({
      size: g.length,
      balance: g[0].balance,
      txCount: g[0].txCount,
      addresses: g.map((s) => s.address).sort(),
    }))
    .sort((a, b) => b.size - a.size);
}

export function findBursts(snaps: ReviewerSnapshot[]): BurstCluster[] {
  const born = snaps
    .filter((s) => s.firstTxAt !== null)
    .map((s) => ({ a: s.address, t: s.firstTxAt as number }))
    .sort((x, y) => x.t - y.t || x.a.localeCompare(y.a));
  const windowS = RULES.burstWindowMinutes * 60;
  const clusters: BurstCluster[] = [];
  let i = 0;
  while (i < born.length) {
    let j = i;
    while (j + 1 < born.length && born[j + 1].t - born[i].t <= windowS) j++;
    const size = j - i + 1;
    if (size >= RULES.burstMinSize) {
      clusters.push({
        start: born[i].t,
        end: born[j].t,
        size,
        addresses: born.slice(i, j + 1).map((b) => b.a),
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  return clusters.sort((a, b) => b.size - a.size || a.start - b.start);
}

function judgeReviewer(
  snap: ReviewerSnapshot,
  reviews: number,
  agent: AgentIdentity,
  cluster: BurstCluster | undefined,
  asOf: number,
  windowDays: number,
  footprint?: FootprintGroup
): ReviewerVerdict {
  const flags: ReviewerFlag[] = [];
  const reasons: string[] = [];

  // Age
  let ageDays: number | null = null;
  let ageIsLowerBound = false;
  let age: number;
  if (snap.firstTxBeforeWindow) {
    ageDays = windowDays;
    ageIsLowerBound = true;
    // We only know it's older than the window. Credit what we can see: on a
    // 7-day window that's half marks, not full ones.
    age = clamp((windowDays / RULES.ageSaturationDays) * 100);
  } else if (snap.firstTxAt !== null) {
    ageDays = Math.max(0, (asOf - snap.firstTxAt) / DAY);
    age = clamp((ageDays / RULES.ageSaturationDays) * 100);
  } else if (snap.txCount === 0) {
    age = 0;
  } else {
    age = 50; // we could not see its history; neither reward nor punish
    flags.push("history_unavailable");
    reasons.push("The RPC could not show this wallet's history, so its age is unknown.");
  }

  // Activity of its own: transactions not spent reviewing this agent.
  const otherTxCount = Math.max(0, snap.txCount - reviews);
  const activity = clamp((Math.log10(otherTxCount + 1) / 2) * 100);
  // Balance, weighted lightly: testnet MON is free from a faucet.
  const balance = clamp((Math.log10(snap.balance + 1) / Math.log10(11)) * 100);

  const burstMultiplier = cluster || footprint ? 0.5 : 1;
  const base = snap.isContract
    ? age // a contract's nonce doesn't reflect use; judge it by age alone
    : RULES.weights.age * age + RULES.weights.activity * activity + RULES.weights.balance * balance;

  const linked =
    snap.address === agent.owner || (agent.agentWallet !== null && snap.address === agent.agentWallet);

  let credibility = Math.round(clamp(base * burstMultiplier));
  if (linked) {
    credibility = 0;
    flags.push("linked_to_agent");
    reasons.push("This is the agent's own wallet.");
  }

  if (cluster) {
    flags.push("burst");
    reasons.push(
      `First transaction came within ${formatDuration(Math.max(60, cluster.end - cluster.start))} of ${plural(
        cluster.size - 1,
        "other reviewer"
      )}.`
    );
  }
  if (footprint) {
    flags.push("same_footprint");
    reasons.push(
      `Holds exactly the same balance (${footprint.balance.toPrecision(4)} MON) and has made the same number of transactions (${
        footprint.txCount
      }) as ${plural(footprint.size - 1, "other reviewer")}.`
    );
  }
  if (snap.isContract) {
    flags.push("contract");
    reasons.push("Reviews come from a smart contract, so it is judged by age only.");
  } else if (otherTxCount <= 2) {
    flags.push("single_purpose");
    reasons.push(
      otherTxCount === 0
        ? "It has done nothing on-chain except review this agent."
        : `Apart from reviewing this agent, it has sent ${plural(otherTxCount, "transaction")}.`
    );
  }
  if (ageDays !== null && !ageIsLowerBound && ageDays < 1) {
    flags.push("brand_new");
    reasons.push(`Its first transaction was ${formatDuration(ageDays * DAY)} ago.`);
  }

  const counted = !linked && credibility >= RULES.countThreshold;
  if (counted && reasons.length === 0) {
    const bits: string[] = [];
    if (ageIsLowerBound) bits.push(`active for more than ${windowDays} days`);
    else if (ageDays !== null) bits.push(`active for ${formatDuration(ageDays * DAY)}`);
    if (!snap.isContract) bits.push(`${plural(otherTxCount, "other transaction")}`);
    reasons.push(`Established wallet: ${bits.join(", ")}.`);
  }

  return {
    address: snap.address,
    reviews,
    credibility,
    counted,
    flags,
    reasons,
    parts: {
      age: Math.round(age),
      activity: Math.round(activity),
      balance: Math.round(balance),
      burstMultiplier,
    },
    facts: {
      isContract: snap.isContract,
      txCount: snap.txCount,
      otherTxCount,
      balance: snap.balance,
      ageDays: ageDays === null ? null : round1(ageDays),
      ageIsLowerBound,
      firstTxAt: snap.firstTxAt,
    },
  };
}

/** Mirrors ReputationRegistry.getSummary: filter by clients, tag1 "" = any tag. */
export function summaryLike(entries: FeedbackEntry[], clients: Set<string>, tag1: string): number | null {
  return mean(entries.filter((e) => clients.has(e.client) && (tag1 === "" || e.tag1 === tag1)).map((e) => e.value));
}

function tagSummaries(entries: FeedbackEntry[], countedSet: Set<string>): TagSummary[] {
  const byTag = new Map<string, FeedbackEntry[]>();
  for (const e of entries) {
    const list = byTag.get(e.tag1) ?? [];
    list.push(e);
    byTag.set(e.tag1, list);
  }
  const out: TagSummary[] = [];
  for (const [tag, list] of byTag) {
    const counted = list.filter((e) => countedSet.has(e.client));
    out.push({
      tag,
      listed: {
        reviews: list.length,
        reviewers: new Set(list.map((e) => e.client)).size,
        average: mean(list.map((e) => e.value)),
      },
      counted: {
        reviews: counted.length,
        reviewers: new Set(counted.map((e) => e.client)).size,
        average: mean(counted.map((e) => e.value)),
      },
    });
  }
  return out.sort((a, b) => b.listed.reviews - a.listed.reviews || a.tag.localeCompare(b.tag));
}

function pickHeadlineTag(tags: TagSummary[]): string {
  const starred = tags.find((t) => t.tag.toLowerCase() === "starred");
  if (starred) return starred.tag;
  return tags[0]?.tag ?? "";
}

export interface AuditInput {
  agent: AgentIdentity;
  feedback: FeedbackEntry[];
  snapshots: ReviewerSnapshot[];
  notAnalyzed: string[];
  net?: Net;
  asOf: { block: number; timestamp: number; windowDays: number; windowStartBlock: number };
}

export function auditAgent(input: AuditInput): AgentAudit {
  const { agent, feedback, snapshots, notAnalyzed, asOf } = input;
  const cfg = NETS[input.net ?? "testnet"];

  const reviewCount = new Map<string, number>();
  for (const f of feedback) reviewCount.set(f.client, (reviewCount.get(f.client) ?? 0) + 1);

  const clusters = findBursts(snapshots);
  const clusterOf = new Map<string, BurstCluster>();
  for (const c of clusters) for (const a of c.addresses) clusterOf.set(a, c);
  const footprints = findFootprints(snapshots);
  const footprintOf = new Map<string, FootprintGroup>();
  for (const g of footprints) for (const a of g.addresses) footprintOf.set(a, g);

  const reviewers = snapshots
    .map((s) =>
      judgeReviewer(
        s,
        reviewCount.get(s.address) ?? 0,
        agent,
        clusterOf.get(s.address),
        asOf.timestamp,
        asOf.windowDays,
        footprintOf.get(s.address)
      )
    )
    .sort((a, b) => Number(b.counted) - Number(a.counted) || b.credibility - a.credibility || a.address.localeCompare(b.address));

  const countedSet = new Set(reviewers.filter((r) => r.counted).map((r) => r.address));
  const tags = tagSummaries(feedback, countedSet);
  const headlineTag = pickHeadlineTag(tags);

  const analyzed = reviewers.length;
  const counted = countedSet.size;
  const struck = analyzed - counted;

  let verdict: AuditVerdict;
  if (feedback.length === 0) verdict = "none";
  else if (analyzed < 3) verdict = "thin";
  else if (struck / analyzed >= 0.5) verdict = "inflated";
  else if (struck / analyzed >= 0.2) verdict = "mixed";
  else verdict = "organic";

  const allReviewers = new Set(feedback.map((f) => f.client)).size;
  const singlePurpose = reviewers.filter((r) => r.flags.includes("single_purpose")).length;
  const linked = reviewers.some((r) => r.flags.includes("linked_to_agent"));
  const biggest = clusters[0];

  let headline: string;
  if (verdict === "none") {
    headline = "No one has reviewed this agent yet.";
  } else if (verdict === "thin") {
    headline = `Only ${plural(allReviewers, "wallet has", "wallets have")} reviewed this agent, which is too few to judge.`;
  } else if (biggest && biggest.size >= RULES.burstMinSize) {
    headline = `${biggest.size} of ${analyzed} reviewer wallets made their first transaction within ${formatDuration(
      Math.max(60, biggest.end - biggest.start)
    )} of each other.`;
  } else if (footprints[0] && footprints[0].size >= RULES.burstMinSize) {
    const g = footprints[0];
    headline = `${g.size} of ${analyzed} reviewer wallets hold exactly the same balance (${g.balance.toPrecision(
      4
    )} MON) and have made exactly ${plural(g.txCount, "transaction")} each.`;
  } else if (linked) {
    headline = "One of the reviewers is the agent's own wallet.";
  } else if (singlePurpose >= 2 && singlePurpose / analyzed >= 0.3) {
    headline = `${singlePurpose} of ${analyzed} reviewers have done almost nothing on-chain except review this agent.`;
  } else if (verdict === "organic") {
    headline = `${counted} of ${analyzed} reviewers are established wallets with on-chain history of their own.`;
  } else {
    headline = `${struck} of ${analyzed} reviewers don't meet the bar for an established wallet.`;
  }

  const countedClients = [...countedSet].sort();
  const onchainCheck =
    countedClients.length > 0
      ? {
          registry: cfg.reputationRegistry,
          function: "getSummary(uint256,address[],string,string)",
          agentId: agent.agentId,
          clientAddresses: countedClients,
          tag1: headlineTag,
          tag2: "",
          expectedAverage: summaryLike(feedback, countedSet, headlineTag),
          calldata: encodeGetSummary(agent.agentId, countedClients, headlineTag),
          castCommand: `cast call ${cfg.reputationRegistry} "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" ${
            agent.agentId
          } "[${countedClients.join(",")}]" "${headlineTag}" "" --rpc-url ${cfg.defaultRpcs[0]}`,
        }
      : null;

  const canonical = JSON.stringify({
    agentId: agent.agentId,
    block: asOf.block,
    rules: RULES,
    reviewers: reviewers.map((r) => [r.address, r.credibility, r.counted]),
  });

  return {
    agent,
    verdict,
    headline,
    headlineTag,
    tags,
    reviewers,
    notAnalyzed,
    clusters,
    footprints,
    totals: { reviews: feedback.length, reviewers: allReviewers, counted, struck },
    onchainCheck,
    asOf,
    rules: {
      countThreshold: RULES.countThreshold,
      burstWindowMinutes: RULES.burstWindowMinutes,
      burstMinSize: RULES.burstMinSize,
      ageSaturationDays: RULES.ageSaturationDays,
    },
    auditHash: keccak256(toUtf8Bytes(canonical)),
    chain: cfg.slug,
  };
}
