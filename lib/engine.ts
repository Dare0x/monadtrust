// MonadTrust deterministic scoring engine.
//
// RULE (inherited by design): nothing in this file calls an LLM, and nothing
// here invents a number. Every value is computed from the OnChainActivity
// snapshot, which itself is a set of reproducible public-RPC reads. An AI
// layer may later *explain* this output in plain English, but it can never
// produce or alter the score.
//
// The score answers one narrow, honest question: "based only on on-chain
// behavior we can verify for free, how established and consistently-active is
// this address?" It is NOT a proof of honesty or humanity — we say so in the
// UI — it is a transparent, reproducible reputation signal.

import { OnChainActivity, MetricBreakdown, TrustScoreResult } from "./types";

const DAY = 86_400;

// The free RPC only lets us *measure* age within its archive window (~28d),
// so we saturate the age score at the edge of what we can actually observe.
const AGE_SATURATION_DAYS = 30;
// Silence beyond this many days reads as dormant.
const RECENCY_HORIZON_DAYS = 14;

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

function daysSince(unixSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, (now - unixSeconds) / DAY);
}

// --- Individual metric computations -----------------------------------

/** Longevity: older accounts are harder to fabricate cheaply. */
function computeAge(activity: OnChainActivity): MetricBreakdown {
  if (activity.firstSeen === null) {
    return {
      key: "age",
      label: "Account age",
      value: 12, // no outbound history: treated cautiously, not as zero
      raw: "no outbound txns",
      detail: "This address has never sent a transaction, so it has no age.",
    };
  }
  const age = daysSince(activity.firstSeen);
  if (activity.firstSeenBeforeWindow) {
    // Active before our visible window → at least window-old → established.
    return {
      key: "age",
      label: "Account age",
      value: 100,
      raw: `≥ ${age.toFixed(0)} days`,
      detail: `Already active before our visible ${activity.windowDays}-day window began, so it is at least ${age.toFixed(
        0
      )} days old (likely older).`,
    };
  }
  const score = clamp((age / AGE_SATURATION_DAYS) * 100);
  return {
    key: "age",
    label: "Account age",
    value: score,
    raw: `${age.toFixed(0)} days`,
    detail: `First transaction was about ${age.toFixed(
      0
    )} days ago (measured within the visible ${activity.windowDays}-day window).`,
  };
}

/** Activity volume: sustained use signals a real, in-use account. */
function computeActivity(activity: OnChainActivity): MetricBreakdown {
  const n = activity.txCount;
  // Log scale: 0 tx -> 0, ~10 -> 50, ~100+ -> ~100.
  const score = clamp((Math.log10(n + 1) / 2) * 100);
  return {
    key: "activity",
    label: "Activity level",
    value: score,
    raw: `${n} txns`,
    detail: `Address has sent ${n} transaction${
      n === 1 ? "" : "s"
    } in total (account nonce).`,
  };
}

/**
 * Recency: an account active recently is more likely live and controlled.
 * Dormant accounts score lower (and get a flag) — not a moral judgment, just
 * that a currently-live counterparty is safer to transact with.
 */
function computeRecency(activity: OnChainActivity): MetricBreakdown {
  if (activity.lastSeen === null) {
    return {
      key: "recency",
      label: "Recent activity",
      value: 12,
      raw: "no outbound txns",
      detail: "No outbound transactions found to date.",
    };
  }
  const idle = daysSince(activity.lastSeen);
  const score = clamp(100 - (idle / RECENCY_HORIZON_DAYS) * 100);
  return {
    key: "recency",
    label: "Recent activity",
    value: score,
    raw: idle < 1 ? "today" : `${idle.toFixed(0)}d ago`,
    detail: `Most recent transaction was about ${idle.toFixed(
      0
    )} day(s) ago.`,
  };
}

/**
 * Native balance: some skin in the game. Deliberately low-weighted and
 * flagged in-copy, because testnet MON is free from a faucet and thus a weak
 * trust signal — we include it for context, not as a pillar of the score.
 */
function computeBalance(activity: OnChainActivity): MetricBreakdown {
  const b = activity.balance;
  const score = clamp((Math.log10(b + 1) / 2) * 100);
  return {
    key: "balance",
    label: "Native balance",
    value: score,
    raw: `${b.toFixed(3)} MON`,
    detail: `Holds ${b.toFixed(
      3
    )} MON. Testnet MON is faucet-funded, so this is weighted lightly.`,
  };
}

// --- Top-level entrypoint ------------------------------------------------

const METRIC_WEIGHTS: Record<string, number> = {
  age: 0.3,
  activity: 0.3,
  recency: 0.25,
  balance: 0.15,
};

function bandFor(
  score: number,
  hasActivity: boolean
): TrustScoreResult["band"] {
  if (!hasActivity) return "new";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function computeTrustScore(
  activity: OnChainActivity,
  label?: string
): TrustScoreResult {
  const metrics: MetricBreakdown[] = [
    computeAge(activity),
    computeActivity(activity),
    computeRecency(activity),
    computeBalance(activity),
  ];

  const trustScore = Math.round(
    clamp(
      metrics.reduce(
        (sum, m) => sum + m.value * (METRIC_WEIGHTS[m.key] ?? 0),
        0
      )
    )
  );

  const hasActivity = activity.txCount > 0;
  const ageDays = activity.firstSeen === null ? null : daysSince(activity.firstSeen);
  const lastActiveDays =
    activity.lastSeen === null ? null : daysSince(activity.lastSeen);

  const flags: string[] = [];
  if (activity.txCount === 0) flags.push("no_activity");
  if (
    ageDays !== null &&
    !activity.firstSeenBeforeWindow &&
    ageDays < 3
  ) {
    flags.push("very_new");
  }
  const recency = metrics.find((m) => m.key === "recency")!;
  if (hasActivity && recency.value < 25) flags.push("dormant");
  if (activity.isContract) flags.push("contract");
  if (activity.txCount > 100_000) flags.push("high_volume_automated");

  return {
    address: activity.address,
    label,
    trustScore,
    band: bandFor(trustScore, hasActivity),
    metrics,
    flags,
    isContract: activity.isContract,
    activitySummary: {
      txCount: activity.txCount,
      ageDays: ageDays === null ? null : Math.round(ageDays),
      ageIsLowerBound: activity.firstSeenBeforeWindow,
      balance: activity.balance,
      lastActiveDays: lastActiveDays === null ? null : Math.round(lastActiveDays),
    },
    visibility: {
      windowDays: activity.windowDays,
      latestBlock: activity.latestBlock,
      scannedFromBlock: activity.scannedFromBlock,
    },
    computedAt: Date.now(),
    chain: "monad-testnet",
  };
}
