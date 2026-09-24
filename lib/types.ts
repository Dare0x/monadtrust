// MonadTrust — core types.
//
// A "trust score" here is a 0–100 reputation signal for an on-chain
// address (a wallet or an autonomous agent) on Monad, computed ONLY from
// signals we can independently verify for free via public JSON-RPC. Every
// sub-metric is traceable to a real chain read that anyone can reproduce —
// nothing here is guessed, and nothing is produced by an AI model.
//
// Deliberate honesty: the free public RPC caps eth_getLogs at a 100-block
// range and prunes historical state to roughly the last month. So we do NOT
// claim to see full token/counterparty history (that needs a paid indexer we
// refuse to require). We score what is verifiable: account age, transaction
// volume, recency of activity, and native balance — and we say so plainly.

export interface OnChainActivity {
  address: string;
  // True if the address has deployed bytecode (a contract / on-chain agent)
  // rather than being a plain externally-owned wallet.
  isContract: boolean;
  // Native MON balance, human-readable units.
  balance: number;
  // Total transactions sent from this address (the account nonce). This is
  // outbound activity only — it does not count inbound transfers.
  txCount: number;
  // Unix seconds of the first outbound transaction we could find. If the
  // account was already active before our visible window, this is the
  // window's start (a lower bound) and firstSeenBeforeWindow is true.
  firstSeen: number | null;
  // Unix seconds of the most recent outbound transaction we could find.
  lastSeen: number | null;
  // True when the account's first activity predates our archive window, so
  // its real age is *at least* (now - firstSeen), possibly much more.
  firstSeenBeforeWindow: boolean;
  // True when the account's most recent activity ALSO predates our archive
  // window (it had already reached its final nonce before the window began),
  // so "last active" is a lower bound: at least (now - lastSeen), maybe more.
  lastSeenBeforeWindow: boolean;
  // How many days of history the RPC actually let us inspect (the archive
  // window). Used for honest UI copy, e.g. "within the visible ~31 days".
  windowDays: number;
  // Reproducibility context: the block range this snapshot was derived from.
  latestBlock: number;
  scannedFromBlock: number;
}

export interface MetricBreakdown {
  key: string;
  label: string;
  value: number; // 0–100 normalized sub-score
  raw: string; // human-readable raw stat, e.g. "142 txns"
  detail: string; // short factual sentence — no AI, no opinion
}

export interface TrustScoreResult {
  address: string;
  label?: string;
  trustScore: number; // 0–100, weighted from the metrics below
  band: "high" | "medium" | "low" | "new"; // human-friendly bucket
  metrics: MetricBreakdown[];
  flags: string[]; // deterministic risk flags, e.g. "dormant", "very_new"
  isContract: boolean;
  activitySummary: {
    txCount: number;
    ageDays: number | null;
    ageIsLowerBound: boolean; // true when the real age exceeds what we can see
    balance: number;
    lastActiveDays: number | null;
    lastActiveIsLowerBound: boolean; // true when real idle time exceeds what we can see
  };
  visibility: {
    // Honest disclosure of what we could and couldn't inspect for free.
    windowDays: number;
    latestBlock: number;
    scannedFromBlock: number;
  };
  computedAt: number;
  chain: "monad-testnet";
}

// ---------------------------------------------------------------------------
// ERC-8004 review audit types
// ---------------------------------------------------------------------------

export interface AgentCard {
  name: string | null;
  description: string | null;
  image: string | null;
}

export interface AgentIdentity {
  agentId: string;
  owner: string;
  agentWallet: string | null;
  uri: string | null;
  card: AgentCard | null;
}

/** One stored feedback entry from the ERC-8004 Reputation Registry. */
export interface FeedbackEntry {
  client: string;
  index: number;
  rawValue: string; // exact int128 as a decimal string
  decimals: number;
  value: number; // rawValue / 10^decimals
  tag1: string;
  tag2: string;
}

/** Public, verifiable facts about one reviewer wallet. */
export interface ReviewerSnapshot {
  address: string;
  isContract: boolean;
  balance: number;
  txCount: number;
  firstTxAt: number | null; // unix seconds, only when born inside the window
  firstTxBlock: number | null;
  firstTxBeforeWindow: boolean; // older than the visible window
  historyAvailable: boolean; // false if the RPC couldn't serve old state
}

export type ReviewerFlag =
  | "linked_to_agent" // reviewer is the agent's own wallet
  | "burst" // first transaction within minutes of several other reviewers
  | "single_purpose" // has done almost nothing except review this agent
  | "brand_new" // first transaction less than a day ago
  | "contract" // reviews posted by a smart contract
  | "history_unavailable";

export interface ReviewerVerdict {
  address: string;
  reviews: number; // feedback entries this reviewer gave the agent
  credibility: number; // 0-100
  counted: boolean;
  flags: ReviewerFlag[];
  reasons: string[]; // plain-English, factual
  parts: { age: number; activity: number; balance: number; burstMultiplier: number };
  facts: {
    isContract: boolean;
    txCount: number;
    otherTxCount: number; // transactions not spent reviewing this agent
    balance: number;
    ageDays: number | null;
    ageIsLowerBound: boolean;
    firstTxAt: number | null;
  };
}

export interface TagSummary {
  tag: string; // "" means untagged
  listed: { reviews: number; reviewers: number; average: number | null };
  counted: { reviews: number; reviewers: number; average: number | null };
}

export interface BurstCluster {
  start: number; // unix seconds
  end: number;
  size: number;
  addresses: string[];
}

export type AuditVerdict = "organic" | "mixed" | "inflated" | "thin" | "none";

export interface AgentAudit {
  agent: AgentIdentity;
  verdict: AuditVerdict;
  headline: string; // one factual sentence
  headlineTag: string;
  tags: TagSummary[];
  reviewers: ReviewerVerdict[];
  notAnalyzed: string[]; // reviewers we could not read or skipped (cap)
  clusters: BurstCluster[];
  totals: {
    reviews: number;
    reviewers: number;
    counted: number;
    struck: number;
  };
  onchainCheck: {
    registry: string;
    function: string;
    agentId: string;
    clientAddresses: string[];
    tag1: string;
    tag2: string;
    expectedAverage: number | null;
    calldata: string;
    castCommand: string;
    // What the registry itself returned for this call when the audit ran.
    // Filled in by the service after the audit; not part of auditHash.
    registryAnswer?: { count: number; value: number; decimals: number } | null;
  } | null;
  asOf: { block: number; timestamp: number; windowDays: number; windowStartBlock: number };
  rules: { countThreshold: number; burstWindowMinutes: number; burstMinSize: number; ageSaturationDays: number };
  auditHash: string;
  chain: "monad-testnet";
}

export interface AgentListing {
  agentId: string;
  reviewers: number;
  name: string | null;
  owner: string | null;
}
