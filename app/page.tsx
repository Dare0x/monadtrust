"use client";

import { useState, useCallback, useRef } from "react";
import type { TrustScoreResult } from "@/lib/types";
import deployment from "@/contracts/deployment.json";

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

// The live TrustRegistry contract, read from contracts/deployment.json if deployed.
const REGISTRY: { address: string } | null =
  deployment && typeof (deployment as { address?: string }).address === "string"
    ? { address: (deployment as { address: string }).address }
    : null;

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrustScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{
    text: string;
    source: "llm" | "fallback";
  } | null>(null);
  const [explaining, setExplaining] = useState(false);
  // Monotonic token so a slow response from an earlier lookup can't overwrite
  // the results of a newer one (e.g. two example chips clicked in quick succession).
  const runSeq = useRef(0);

  const run = useCallback(async (address: string) => {
    const addr = address.trim();
    if (!addr) return;
    const seq = ++runSeq.current;
    setLoading(true);
    setError(null);
    setResult(null);
    setExplanation(null);

    let scored: TrustScoreResult | null = null;
    try {
      const res = await fetch(`/api/score/${encodeURIComponent(addr)}`);
      const data = await res.json();
      if (seq !== runSeq.current) return; // superseded by a newer lookup
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        scored = data as TrustScoreResult;
        setResult(scored);
      }
    } catch {
      if (seq !== runSeq.current) return;
      setError("Network error — could not reach the scoring service.");
    } finally {
      if (seq === runSeq.current) setLoading(false);
    }

    if (!scored) return;

    // Explanation is a non-blocking enhancement: the score is already shown.
    setExplaining(true);
    try {
      const er = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scored),
      });
      const ed = await er.json();
      if (seq !== runSeq.current) return; // stale explanation — drop it
      if (er.ok && typeof ed?.text === "string") {
        setExplanation({
          text: ed.text,
          source: ed.source === "llm" ? "llm" : "fallback",
        });
      }
    } catch {
      /* explanation is optional — never block the score on it */
    } finally {
      if (seq === runSeq.current) setExplaining(false);
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

      {REGISTRY && (
        <a
          className="chainbadge"
          href={`${EXPLORER}${REGISTRY.address}`}
          target="_blank"
          rel="noreferrer"
          title="MonadTrust TrustRegistry — live on Monad testnet"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            margin: "0 0 22px",
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid var(--border-strong)",
            color: "var(--text-dim)",
            fontSize: 13,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--green)",
              display: "inline-block",
              boxShadow: "0 0 8px var(--green)",
            }}
          />
          Live on-chain registry ·{" "}
          <span
            style={{
              color: "var(--text)",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {REGISTRY.address.slice(0, 6)}…{REGISTRY.address.slice(-4)}
          </span>{" "}
          ↗
        </a>
      )}

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

      {result && !loading && (
        <ScoreCard
          result={result}
          explanation={explanation}
          explaining={explaining}
        />
      )}

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

function ScoreCard({
  result,
  explanation,
  explaining,
}: {
  result: TrustScoreResult;
  explanation: { text: string; source: "llm" | "fallback" } | null;
  explaining: boolean;
}) {
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

      <div className="section explain">
        <div className="explain-head">
          <h3>{explanation?.source === "llm" ? "AI explanation" : "Explanation"}</h3>
          {explanation?.source === "llm" ? (
            <span className="ai-badge">AI · does not affect the score</span>
          ) : (
            !explaining &&
            explanation && <span className="ai-badge muted">auto-generated</span>
          )}
        </div>
        {explaining && !explanation ? (
          <p className="explain-loading">
            <span className="dot-pulse" /> Writing a plain-English explanation…
          </p>
        ) : (
          <p className="explain-text">
            {explanation?.text ??
              "This score reflects the address's verifiable on-chain history."}
          </p>
        )}
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
              : `${s.lastActiveIsLowerBound ? "≥ " : ""}${s.lastActiveDays} days ago`}
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
