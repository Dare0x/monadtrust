"use client";

import { useCallback, useRef, useState } from "react";
import type { TrustScoreResult } from "@/lib/types";

const EXPLORER = "https://testnet.monadscan.com/address/";

const BAND_TEXT: Record<TrustScoreResult["band"], string> = {
  high: "Established",
  medium: "Some history",
  low: "Little history",
  new: "No transactions yet",
};

export default function WalletPage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrustScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{ text: string; source: "llm" | "fallback" } | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (raw: string) => {
    const addr = raw.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setError("Paste a full wallet address: 0x followed by 40 letters and numbers.");
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    setResult(null);
    setExplanation(null);
    try {
      const res = await fetch(`/api/score/${addr}`);
      const data = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(data.error ?? "The check failed.");
        return;
      }
      setResult(data as TrustScoreResult);
      const er = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const ed = await er.json();
      if (mine === seq.current && er.ok && typeof ed?.text === "string") {
        setExplanation({ text: ed.text, source: ed.source === "llm" ? "llm" : "fallback" });
      }
    } catch {
      if (mine === seq.current) setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">Check one wallet</h1>
        <p className="hero-lede">
          The same measure MonadTrust applies to every reviewer: how long a wallet has existed on Monad testnet, how
          much it has done, and how recently.
        </p>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
        >
          <input
            className="lookup-input hex"
            style={{ paddingLeft: 16 }}
            aria-label="Wallet address"
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Checking" : "Check wallet"}
          </button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </section>

      {loading && (
        <div className="progress" role="status">
          <div className="progress-line" />
          <p className="progress-text">Reading this wallet&apos;s history on Monad testnet.</p>
        </div>
      )}

      {result && !loading && (
        <section>
          <div className="wallet-score">
            <span className="wallet-number">{result.trustScore}</span>
            <span className="wallet-band">{BAND_TEXT[result.band]}, out of 100</span>
          </div>
          <p className="report-owner">
            <a className="hex" href={EXPLORER + result.address} target="_blank" rel="noreferrer">
              {result.address}
            </a>
            {result.isContract ? " (contract)" : ""}
          </p>
          <div className="metric-list">
            {result.metrics.map((m) => (
              <div className="metric-row" key={m.key}>
                <strong>{m.label}</strong>
                <span className="metric-bar" aria-hidden="true">
                  <span className="metric-fill" style={{ width: `${Math.round(m.value)}%` }} />
                </span>
                <span className="metric-raw">{m.raw}</span>
                <p>{m.detail}</p>
              </div>
            ))}
          </div>
          {explanation && (
            <div className="block">
              <h2 className="block-title">In plain words</h2>
              <p className="summary-text">{explanation.text}</p>
              <p className="source-note">
                {explanation.source === "llm"
                  ? "Written by an AI model from the numbers above. It cannot change them."
                  : "Generated from the numbers above by fixed rules."}
              </p>
            </div>
          )}
          <div className="block">
            <h2 className="block-title">What this check can&apos;t see</h2>
            <div className="limits">
              <p>
                The free RPC keeps about {result.visibility.windowDays} days of history and won&apos;t list past
                transfers, so this measures age and activity only. A high score isn&apos;t proof of honesty.
              </p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
