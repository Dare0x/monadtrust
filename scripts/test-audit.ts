// Deterministic tests for the review-audit engine. No network.
//   npm run test:audit

import { auditAgent, findBursts, summaryLike } from "../lib/audit";
import type { AgentIdentity, FeedbackEntry, ReviewerSnapshot } from "../lib/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

const NOW = 1_790_000_000;
const DAY = 86_400;
const asOf = { block: 50_000_000, timestamp: NOW, windowDays: 28, windowStartBlock: 42_000_000 };
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

const agent: AgentIdentity = {
  agentId: "1831",
  owner: addr(0xaaa),
  agentWallet: addr(0xbbb),
  uri: null,
  card: { name: "Test agent", description: null, image: null },
};

function established(n: number, txCount: number, balance: number): ReviewerSnapshot {
  return {
    address: addr(n),
    isContract: false,
    balance,
    txCount,
    firstTxAt: null,
    firstTxBlock: null,
    firstTxBeforeWindow: true,
    historyAvailable: true,
  };
}
function fresh(n: number, bornSecondsAgo: number, txCount = 1, balance = 0.02): ReviewerSnapshot {
  return {
    address: addr(n),
    isContract: false,
    balance,
    txCount,
    firstTxAt: NOW - bornSecondsAgo,
    firstTxBlock: 49_000_000,
    firstTxBeforeWindow: false,
    historyAvailable: true,
  };
}
function fb(n: number, value: number, tag1 = "starred", index = 1): FeedbackEntry {
  return { client: addr(n), index, rawValue: String(value), decimals: 0, value, tag1, tag2: "" };
}

// --- 1. Organic agent: six established reviewers --------------------------
{
  const snaps = [
    established(1, 120, 3),
    established(2, 45, 1.2),
    established(3, 300, 8),
    established(4, 60, 0.9),
    established(5, 200, 2),
    established(6, 35, 1),
  ];
  const feedback = [fb(1, 80), fb(2, 90), fb(3, 75), fb(4, 85), fb(5, 70), fb(6, 95)];
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf });
  check("organic: verdict", a.verdict === "organic", a.verdict);
  check("organic: everyone counted", a.totals.counted === 6, String(a.totals.counted));
  const t = a.tags[0];
  check("organic: counted average equals listed", t.counted.average === t.listed.average, `${t.counted.average}`);
  check("organic: no bursts", a.clusters.length === 0);
}

// --- 2. Sybil-inflated agent ------------------------------------------------
{
  const honest = [established(10, 150, 2), established(11, 80, 1.5), established(12, 40, 1)];
  // Twelve wallets born within ten minutes of each other, 3 hours ago, whose
  // only transaction is the review itself.
  const sybils = Array.from({ length: 12 }, (_, i) => fresh(100 + i, 3 * 3600 - i * 50));
  const feedback = [fb(10, 55), fb(11, 60), fb(12, 45), ...sybils.map((s) => ({ ...fb(0, 100), client: s.address }))];
  const a = auditAgent({ agent, feedback, snapshots: [...honest, ...sybils], notAnalyzed: [], asOf });
  check("sybil: verdict inflated", a.verdict === "inflated", a.verdict);
  check("sybil: one burst of 12", a.clusters.length === 1 && a.clusters[0].size === 12, JSON.stringify(a.clusters.map((c) => c.size)));
  check("sybil: only honest reviewers counted", a.totals.counted === 3, String(a.totals.counted));
  const t = a.tags.find((x) => x.tag === "starred")!;
  check("sybil: listed average is inflated", Math.round(t.listed.average!) === 91, String(t.listed.average));
  check("sybil: counted average is honest", t.counted.average === (55 + 60 + 45) / 3, String(t.counted.average));
  check("sybil: headline names the burst", a.headline.startsWith("12 of 15 reviewer wallets"), a.headline);
  check("sybil: on-chain check lists 3 clients", a.onchainCheck?.clientAddresses.length === 3);
  const sy = a.reviewers.find((r) => r.address === sybils[0].address)!;
  check("sybil: flags", sy.flags.includes("burst") && sy.flags.includes("single_purpose") && sy.flags.includes("brand_new"), sy.flags.join(","));
}

// --- 3. Self-review via the agent's own wallet --------------------------------
{
  const snaps = [established(1, 100, 2), established(2, 100, 2), { ...established(0, 500, 50), address: agent.agentWallet! }];
  const feedback = [fb(1, 70), fb(2, 72), { ...fb(0, 100), client: agent.agentWallet! }];
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf });
  const self = a.reviewers.find((r) => r.address === agent.agentWallet)!;
  check("self: linked reviewer not counted", !self.counted && self.credibility === 0 && self.flags.includes("linked_to_agent"));
  check("self: verdict mixed", a.verdict === "mixed", a.verdict);
}

// --- 4. Repeat reviewer: one wallet posting many times -----------------------
{
  const snaps = [established(1, 100, 2), established(2, 90, 2), established(3, 150, 2)];
  const feedback = [fb(1, 60), fb(2, 65), ...Array.from({ length: 10 }, (_, i) => fb(3, 100, "starred", i + 1))];
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf });
  const r3 = a.reviewers.find((r) => r.address === addr(3))!;
  check("repeat: reviews per wallet counted", r3.reviews === 10);
  check("repeat: activity excludes own reviews", r3.facts.otherTxCount === 140);
}

// --- 5. getSummary semantics ---------------------------------------------------
{
  const entries = [fb(1, 80, "starred"), fb(1, 1, "reachable"), fb(2, 60, "starred")];
  const set = new Set([addr(1), addr(2)]);
  check("summaryLike: tag filter", summaryLike(entries, set, "starred") === 70);
  check("summaryLike: empty tag means all", summaryLike(entries, set, "") === (80 + 1 + 60) / 3);
}

// --- 6. Determinism ---------------------------------------------------------------
{
  const snaps = [fresh(7, 5000), fresh(8, 4900), fresh(9, 4800), established(10, 50, 1)];
  const feedback = [fb(7, 100), fb(8, 100), fb(9, 100), fb(10, 50)];
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf });
  const b = auditAgent({ agent, feedback, snapshots: [...snaps].reverse(), notAnalyzed: [], asOf });
  check("determinism: same hash regardless of input order", a.auditHash === b.auditHash);
  check("bursts: three wallets within 200s form one burst", findBursts(snaps).length === 1);
}

// --- Identical footprints: same balance to the wei and same tx count -------
{
  const farm = (n: number) => ({ ...established(n, 3, 0.002142), balanceWei: "2142000000000000" });
  const real = (n: number, tx: number, wei: string) => ({ ...established(n, tx, Number(wei) / 1e18), balanceWei: wei });
  const snaps = [farm(0x300), farm(0x301), farm(0x302), farm(0x303), real(0x310, 90, "1500000000000000000"), real(0x311, 60, "2500000000000000000")];
  const feedback = snaps.map((s, i) => fb(parseInt(s.address, 16), i < 4 ? 100 : 60));
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf });
  check("footprint: group of 4 found", a.footprints?.[0]?.size === 4, JSON.stringify(a.footprints?.map((g) => g.size)));
  check("footprint: farm wallets flagged", a.reviewers.filter((r) => r.flags.includes("same_footprint")).length === 4);
  check("footprint: real wallets untouched", a.reviewers.filter((r) => !r.flags.includes("same_footprint")).every((r) => r.counted));
  check("footprint: headline names it", /same balance/.test(a.headline), a.headline);
  const two = auditAgent({ agent, feedback: feedback.slice(0, 2), snapshots: snaps.slice(0, 2), notAnalyzed: [], asOf });
  check("footprint: two matching wallets is not a group", (two.footprints ?? []).length === 0);
}

// --- Short history window (mainnet keeps ~7 days) -------------------------
{
  const shortAsOf = { ...asOf, windowDays: 7 };
  const snaps = [established(0x400, 3, 0), established(0x401, 3, 0), established(0x402, 250, 4)];
  snaps[1] = { ...snaps[1], balance: 0.0001 };
  const feedback = snaps.map((s) => fb(parseInt(s.address, 16), 80));
  const a = auditAgent({ agent, feedback, snapshots: snaps, notAnalyzed: [], asOf: shortAsOf });
  const low = a.reviewers.find((r) => r.address === addr(0x400))!;
  check("short window: 'older than 7 days' earns half the age marks", low.parts.age === 50, String(low.parts.age));
  check("short window: near-idle old wallet is not counted", !low.counted, String(low.credibility));
  check("short window: active old wallet still counts", a.reviewers.find((r) => r.address === addr(0x402))!.counted);
}

console.log(failures === 0 ? "\nAll audit tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
