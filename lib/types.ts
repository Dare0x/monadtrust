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
