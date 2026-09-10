"use client";

import { useState, useCallback } from "react";
import type { TrustScoreResult } from "@/lib/types";

const EXAMPLES: { label: string; address: string }[] = [
  { label: "High-activity account", address: "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e" },
  { label: "Contract", address: "0xf4423741c7f2e93fa7da3ff2a29eedcaeef80395" },
  { label: "Fresh wallet", address: "0x309cd955024b72FA04e5b6a375F8c923b0303cF5" },
];

const FLAG_META: Record<string, { label: string; kind: "warn" | "info" | "" }> = {
  no_activity: { label: "No outbound activity", kind: "info" },
  very_new: { label: "Very new (< 3 days)", kind: "warn" },
  dormant: { label: "Dormant", kind: "warn" },
  contract: { label: "Contract account", kind: "info" },
  high_volume_automated: { label: "High-volume / automated", kind: "info" },
};

const BAND_COLOR: Record<string, string> = {
  high: "var(--green)",
  medium: "var(--yellow)",
  low: "var(--red)",
  new: "var(--blue)",
};

const EXPLORER = "https://testnet.monadscan.com/address/";

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrustScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (address: string) => {
    const addr = address.trim();
    if (!addr) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/score/${addr}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setResult(data as TrustScoreResult);
      }
    } catch {
      setError("Network error — could not reach the scoring service.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <main className="wrap">
      <div className="brand">
        <div className="logo">M</div>
        <h1>MonadTrust</h1>
      </div>
      <p className="tagline">
        A <strong>transparent, reproducible</strong> reputation score for any
        wallet or agent on Monad. Every number comes only from{" "}
        <strong>public on-chain data</strong> — no indexer, no API keys, and{" "}
        <strong>no AI-invented scores</strong>. Paste an address to see exactly
        how trustworthy its on-chain history is, and why.
      </p>

      <div className="search">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(input)}
          placeholder="0x… paste a Monad testnet address"
          spellCheck={false}
          autoComplete="off"
        />
        <button onClick={() => run(input)} disabled={loading}>
          {loading ? "Scoring…" : "Score"}
        </button>
      </div>

      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.address}
            className="chip"
            onClick={() => {
              setInput(ex.address);
              run(ex.address);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          Reading Monad testnet — balance, nonce, then binary-searching the
          account&apos;s history…
        </div>
      )}

      {result && !loading && <ScoreCard result={result} />}

      <footer>
        <span>
          Built on Monad testnet · reads via public JSON-RPC · fully
          open-source
        </span>
        <span>Not financial advice · not a proof of honesty</span>
      </footer>
    </main>
  );
}

function ScoreCard({ result }: { result: TrustScoreResult }) {
  const color = BAND_COLOR[result.band] ?? "var(--purple)";
  const s = result.activitySummary;

  return (
    <div className="result">
      <div className="card">
        <div className="score-head">
          <div
            className="gauge"
            style={
              {
                ["--p" as string]: result.trustScore,
                ["--c" as string]: color,
              } as React.CSSProperties
            }
          >
            <div className="inner">
              <div>
                <div className="num" style={{ color }}>
                  {result.trustScore}
                </div>
                <div className="of">/ 100</div>
              </div>
            </div>
          </div>

          <div className="score-meta">
            <span className={`band ${result.band}`}>
              {result.band === "new" ? "New / unproven" : `${result.band} trust`}
            </span>
            <div className="addr">
              <a
                href={`${EXPLORER}${result.address}`}
                target="_blank"
                rel="noreferrer"
              >
                {result.address}
              </a>
            </div>
            <div className="addr-sub">
              {result.isContract ? "Contract account" : "Wallet (EOA)"} · Monad
              testnet
            </div>

            {result.flags.length > 0 && (
              <div className="flags">
                {result.flags.map((f) => {
                  const meta = FLAG_META[f] ?? { label: f, kind: "" };
                  return (
                    <span key={f} className={`flag ${meta.kind}`}>
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="metrics">
          {result.metrics.map((m) => (
            <div className="metric" key={m.key}>
              <div className="metric-top">
                <span className="metric-label">{m.label}</span>
                <span className="metric-raw">{m.raw}</span>
              </div>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${Math.round(m.value)}%` }}
                />
              </div>
              <span className="metric-detail">{m.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3>At a glance</h3>
        <dl className="kv">
          <dt>Transactions sent</dt>
          <dd>{s.txCount.toLocaleString()}</dd>
          <dt>Account age</dt>
          <dd>
            {s.ageDays === null
              ? "—"
              : `${s.ageIsLowerBound ? "≥ " : ""}${s.ageDays} days`}
          </dd>
          <dt>Last active</dt>
          <dd>
            {s.lastActiveDays === null
              ? "—"
              : s.lastActiveDays < 1
              ? "today"
              : `${s.lastActiveDays} days ago`}
          </dd>
          <dt>Balance</dt>
          <dd>{s.balance.toFixed(4)} MON</dd>
        </dl>
      </div>

      <div className="section">
        <h3>What we can &amp; can&apos;t see (honest disclosure)</h3>
        <p>
          This score uses only what Monad&apos;s free public RPC can verify.
          The RPC caps log queries at 100 blocks and prunes history to about{" "}
          <b>{result.visibility.windowDays} days</b>, so we do <b>not</b> claim
          to see full token or counterparty history — that would need a paid
          indexer we deliberately avoid. Age and recency are derived by
          binary-searching the account&apos;s historical transaction count.
        </p>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Chain</dt>
          <dd>{result.chain}</dd>
          <dt>Blocks inspected</dt>
          <dd>
            {result.visibility.scannedFromBlock.toLocaleString()} →{" "}
            {result.visibility.latestBlock.toLocaleString()}
          </dd>
        </dl>
      </div>

      <p className="disclaimer">
        MonadTrust measures how <em>established and consistently active</em> an
        address is — nothing more. A high score is not a guarantee of honesty,
        and a &quot;new&quot; score is not an accusation. The number is fully
        deterministic: given the same chain state, anyone running this code gets
        the same result. No large language model produces or adjusts the score.
      </p>
    </div>
  );
}
