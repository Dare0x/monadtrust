"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import BirthStrip from "@/components/BirthStrip";
import type { AgentAudit, ReviewerVerdict } from "@/lib/types";

const EXPLORER = "https://testnet.monadscan.com/address/";

interface Payload {
  audit: AgentAudit;
  summary: { text: string; source: "llm" | "fallback" };
}

const VERDICT_TEXT: Record<AgentAudit["verdict"], string> = {
  organic: "Reviews look organic",
  mixed: "Some reviews don't hold up",
  inflated: "Reviews look inflated",
  thin: "Too few reviews to judge",
  none: "No reviews yet",
};

const VERDICT_TONE: Record<AgentAudit["verdict"], string> = {
  organic: "good",
  mixed: "warn",
  inflated: "bad",
  thin: "muted",
  none: "muted",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));

// Uses the exact first-transaction time where we have it; ageDays is rounded
// to a tenth of a day, which is too coarse for wallets made hours ago.
function ageText(r: ReviewerVerdict, asOf: number): string {
  if (r.facts.ageDays === null) return "unknown";
  if (r.facts.ageIsLowerBound) return `over ${r.facts.ageDays} days`;
  const d = r.facts.firstTxAt !== null ? (asOf - r.facts.firstTxAt) / 86400 : r.facts.ageDays;
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 1440))} min`;
  if (d < 1) return `${Math.round(d * 24)} h`;
  return `${Math.round(d)} days`;
}

function Loading({ id }: { id: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="progress" role="status" aria-live="polite">
      <div className="progress-line" />
      <ol className="progress-steps">
        <li className={secs < 3 ? "is-on" : "is-done"}>Reading agent #{id}&apos;s reviews from the ERC-8004 registry</li>
        <li className={secs >= 3 ? "is-on" : ""}>Tracing each reviewer wallet back to its first transaction</li>
        <li>Finding wallets created in batches and recounting the rating</li>
      </ol>
      <p className="progress-sub">
        {secs}s · an agent with many reviewers can take up to a minute on the free public RPC.
      </p>
    </div>
  );
}

export default function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/agent/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!alive) return;
        if (!r.ok) setError(body.error ?? "The audit failed.");
        else setData(body as Payload);
      })
      .catch(() => alive && setError("Couldn't reach the server. Check your connection and reload."));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <main>
        <Link className="back" href="/">
          All agents
        </Link>
        <div className="problem" role="alert">
          <h2>Couldn&apos;t check agent #{id}</h2>
          <p>{error}</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main>
        <Link className="back" href="/">
          All agents
        </Link>
        <Loading id={id} />
      </main>
    );
  }

  const { audit: a, summary } = data;
  const tag = a.tags.find((t) => t.tag === a.headlineTag) ?? a.tags[0];
  const moved = tag && tag.listed.average !== null && tag.counted.average !== tag.listed.average;
  const scaleNote = a.headlineTag ? `“${a.headlineTag}” rating` : "untagged rating";
  const check = a.onchainCheck;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the text is still selectable */
    }
  }

  return (
    <main>
      <Link className="back" href="/">
        All agents
      </Link>

      <header className="report-head">
        <p className="report-kicker">Agent #{a.agent.agentId} on Monad testnet</p>
        <h1 className="report-name">{a.agent.card?.name ?? `Agent #${a.agent.agentId}`}</h1>
        {a.agent.card?.description && <p className="report-desc">{a.agent.card.description}</p>}
        <p className="report-owner">
          Owned by{" "}
          <a className="hex" href={EXPLORER + a.agent.owner} target="_blank" rel="noreferrer">
            {short(a.agent.owner)}
          </a>
        </p>
        <p className="report-asof">
          Checked at block {a.asOf.block.toLocaleString()} ·{" "}
          {new Date(a.asOf.timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </header>

      <div className={`verdict-banner tone-${VERDICT_TONE[a.verdict]}`}>
        <span className={`pill pill-${VERDICT_TONE[a.verdict]}`}>{VERDICT_TEXT[a.verdict]}</span>
        <p className="finding">{a.headline}</p>
      </div>

      {tag && (
        <div className="ratings">
          <div className={`rating rating-listed${moved ? " is-struck" : ""}`}>
            <p className="rating-label">Listed rating</p>
            <p className="rating-value">
              {fmt(tag.listed.average)}
            </p>
            <p className="rating-note">
              {scaleNote}, {tag.listed.reviews} {tag.listed.reviews === 1 ? "review" : "reviews"} from{" "}
              {tag.listed.reviewers} {tag.listed.reviewers === 1 ? "wallet" : "wallets"}
            </p>
          </div>
          <div className={tag.counted.average === null ? "rating rating-counted is-zero" : "rating rating-counted"}>
            <p className="rating-label">{tag.counted.average === null ? "Reviews that hold up" : "Real rating"}</p>
            <p className="rating-value">
              {tag.counted.average === null ? (
                <>
                  0<span className="rating-of">/{tag.listed.reviews}</span>
                </>
              ) : (
                fmt(tag.counted.average)
              )}
            </p>
            <p className="rating-note">
              {tag.counted.reviews === 0
                ? "No reviewer passed the check"
                : `${tag.counted.reviews} ${tag.counted.reviews === 1 ? "review" : "reviews"} from ${
                    tag.counted.reviewers
                  } established ${tag.counted.reviewers === 1 ? "wallet" : "wallets"}`}
            </p>
          </div>
        </div>
      )}

      {a.reviewers.length > 0 && (
        <section className="block" aria-labelledby="strip-title">
          <h2 className="block-title" id="strip-title">
            When each reviewer wallet was created
          </h2>
          <p className="block-intro">
            Each mark is one reviewer, placed by its first transaction. Real customers arrive over weeks. Wallets made
            in a batch to leave reviews arrive together.
          </p>
          <BirthStrip audit={a} />
        </section>
      )}

      {a.reviewers.length > 0 && (
        <section className="block" aria-labelledby="reviewers-title">
          <h2 className="block-title" id="reviewers-title">
            Every reviewer
          </h2>
          <p className="block-intro">
            Each wallet is scored out of 100: 45% age, 40% activity of its own, 15% balance, halved if it was created in
            a batch with others. Contracts are scored on age alone. A score of {a.rules.countThreshold} or more counts.
          </p>
          <div className="rv-list">
            <div className="rv-row rv-head" aria-hidden="true">
              <span>Wallet</span>
              <span className="num">Reviews</span>
              <span className="num">Age</span>
              <span className="num">Other txs</span>
              <span>Score</span>
              <span className="rv-status">Result</span>
            </div>
            {a.reviewers.map((r) => (
              <div className={r.counted ? "rv-row" : "rv-row is-struck"} key={r.address}>
                <a className="hex rv-addr" href={EXPLORER + r.address} target="_blank" rel="noreferrer">
                  {short(r.address)}
                </a>
                <span className="num" data-k="Reviews">
                  {r.reviews}
                </span>
                <span className="num" data-k="Age">
                  {ageText(r, a.asOf.timestamp)}
                </span>
                <span className="num" data-k="Other txs">
                  {r.facts.isContract ? "contract" : r.facts.otherTxCount.toLocaleString()}
                </span>
                <span className="cred" data-k="Score">
                  <span className="cred-bar" aria-hidden="true">
                    <span
                      className={r.counted ? "cred-fill" : "cred-fill is-bad"}
                      style={{ width: `${Math.max(2, r.credibility)}%` }}
                    />
                  </span>
                  <span className="cred-num">{r.credibility}</span>
                </span>
                <span className="rv-status">
                  <span className={r.counted ? "pill pill-good" : "pill pill-bad"}>{r.counted ? "Counted" : "Struck"}</span>
                </span>
                <p className="reason">{r.reasons.join(" ")}</p>
              </div>
            ))}
          </div>
          {a.notAnalyzed.length > 0 && (
            <p className="block-intro">
              {a.notAnalyzed.length} more reviewer {a.notAnalyzed.length === 1 ? "wallet was" : "wallets were"} not read
              in this pass and {a.notAnalyzed.length === 1 ? "doesn't" : "don't"} count toward the counted rating.
            </p>
          )}
        </section>
      )}

      {a.tags.length > 1 && (
        <section className="block" aria-labelledby="tags-title">
          <h2 className="block-title" id="tags-title">
            Other things reviewers rated
          </h2>
          <p className="block-intro">ERC-8004 reviews carry a tag saying what was measured. Each tag has its own scale.</p>
          <table className="tags">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col" className="num">
                  Listed
                </th>
                <th scope="col" className="num">
                  Counted
                </th>
                <th scope="col" className="num">
                  Reviews
                </th>
              </tr>
            </thead>
            <tbody>
              {a.tags.map((t) => (
                <tr key={t.tag}>
                  <td>{t.tag || "untagged"}</td>
                  <td className="num">{fmt(t.listed.average)}</td>
                  <td className="num">{fmt(t.counted.average)}</td>
                  <td className="num">
                    {t.counted.reviews} of {t.listed.reviews}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {check && (
        <section className="block" aria-labelledby="check-title">
          <h2 className="block-title" id="check-title">
            Check the counted rating on-chain
          </h2>
          <p className="block-intro">
            Ask the ERC-8004 reputation registry for this agent&apos;s summary using only the{" "}
            {check.clientAddresses.length} counted {check.clientAddresses.length === 1 ? "reviewer" : "reviewers"}. It
            should return {fmt(check.expectedAverage)}. Any contract on Monad can make the same call.
          </p>
          <pre className="code">{check.castCommand}</pre>
          <button className="copy" onClick={() => copy(check.castCommand)}>
            {copied ? "Copied" : "Copy command"}
          </button>
        </section>
      )}

      <section className="block" aria-labelledby="summary-title">
        <h2 className="block-title" id="summary-title">
          In plain words
        </h2>
        <p className="summary-text">{summary.text}</p>
        <p className="source-note">
          {summary.source === "llm"
            ? "Written by an AI model from the numbers above. It cannot change them."
            : "Generated from the numbers above by fixed rules."}
        </p>
      </section>

      <section className="block" aria-labelledby="limits-title">
        <h2 className="block-title" id="limits-title">
          What this check can&apos;t see
        </h2>
        <div className="limits">
          <p>
            Monad&apos;s free RPC keeps about {a.asOf.windowDays} days of history, so any wallet older than that simply
            reads as &ldquo;over {a.asOf.windowDays} days&rdquo;. It can&apos;t show who funded a wallet, so two wallets
            paid by the same person look independent unless they were created together.
          </p>
          <p>
            A patient attacker can age wallets and give them activity. These rules make fake reviews slower and more
            expensive to produce. They don&apos;t make them impossible.
          </p>
        </div>
        <dl className="facts">
          <dt>Read at block</dt>
          <dd>{a.asOf.block.toLocaleString()}</dd>
          <dt>History visible from block</dt>
          <dd>{a.asOf.windowStartBlock.toLocaleString()}</dd>
          <dt>Audit fingerprint</dt>
          <dd className="hex">{a.auditHash}</dd>
        </dl>
      </section>
    </main>
  );
}
