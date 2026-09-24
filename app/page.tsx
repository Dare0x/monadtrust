"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgentAudit, AgentListing } from "@/lib/types";

interface Featured {
  agentId: string;
  name: string | null;
  headline: string;
  listed: number | null;
  counted: number | null;
  reviewers: number;
  struck: number;
  checkedAt: number;
  marks: boolean[];
}

interface Directory {
  latestAgentId: string | null;
  scanned: number;
  agents: (AgentListing & { verdict: AgentAudit["verdict"] | null })[];
  featured: Featured | null;
  stats: { agentsAudited: number; reviewersChecked: number; struck: number };
}

const VERDICT_PILL: Record<AgentAudit["verdict"], { text: string; tone: string }> = {
  inflated: { text: "Inflated", tone: "bad" },
  mixed: { text: "Mixed", tone: "warn" },
  organic: { text: "Organic", tone: "good" },
  thin: { text: "Too few", tone: "muted" },
  none: { text: "No reviews", tone: "muted" },
};

const fmt = (v: number | null) => (v === null ? "—" : String(Math.round(v * 10) / 10));

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function Home() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [dir, setDir] = useState<Directory | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/agents")
      .then(async (r) => {
        const data = await r.json();
        if (!alive) return;
        if (!r.ok) setDirError(data.error ?? "Couldn't load the agent list.");
        else setDir(data as Directory);
      })
      .catch(() => alive && setDirError("Couldn't reach the server to load the agent list."));
    return () => {
      alive = false;
    };
  }, []);

  function audit() {
    const clean = id.trim().replace(/^#/, "");
    if (!/^\d{1,12}$/.test(clean)) {
      setFormError("Enter the agent's number from the ERC-8004 registry, like 1924.");
      return;
    }
    setFormError(null);
    router.push(`/agent/${clean}`);
  }

  const max = Math.max(1, ...(dir?.agents.map((a) => a.reviewers) ?? [1]));
  const f = dir?.featured;

  return (
    <main>
      <section className="hero">
        <p className="kicker">ERC-8004 review checker for Monad testnet</p>
        <h1 className="hero-title">
          Who wrote this agent&apos;s reviews?
        </h1>
        <p className="hero-lede">
          Any wallet can rate an AI agent under ERC-8004, and a wallet made a minute ago counts the same as a customer
          of five months. MonadTrust looks up every reviewer and recomputes the rating from the ones that hold up.
        </p>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            audit();
          }}
        >
          <label className="lookup-prefix" htmlFor="agent-id">
            Agent #
          </label>
          <input
            id="agent-id"
            className="lookup-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1924"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <button className="button" type="submit">
            Check reviews
          </button>
        </form>
        {formError && <p className="form-error">{formError}</p>}

        {dir && (
          <p className="tally">
            <span>{dir.scanned.toLocaleString()}</span> agents scanned · <span>{dir.agents.length}</span> with reviews ·{" "}
            <span>{dir.stats.reviewersChecked}</span> reviewers checked ·{" "}
            <span className="tally-bad">{dir.stats.struck}</span> reviews struck
          </p>
        )}
      </section>

      {f && (
        <Link href={`/agent/${f.agentId}`} className="catch" aria-labelledby="catch-title">
          <p className="catch-kicker">
            Flagged: agent #{f.agentId}
            {f.name ? ` (${f.name})` : ""}, checked {ago(f.checkedAt)}
          </p>
          <div className="catch-grid">
            <div>
              <h2 className="catch-title" id="catch-title">
                {f.headline}
              </h2>
              <div className="dots" aria-label={`${f.reviewers - f.struck} counted, ${f.struck} struck`}>
                {f.marks.map((ok, i) => (
                  <span key={i} className={ok ? "dot dot-good" : "dot dot-bad"} />
                ))}
              </div>
              <p className="catch-legend">One square per reviewer wallet. Red ones don&apos;t count.</p>
            </div>
            <div className="catch-score">
              <div className="catch-num">
                <span className="catch-label">Listed rating</span>
                <span className="catch-value catch-listed">{fmt(f.listed)}</span>
              </div>
              {f.counted === null ? (
                <div className="catch-num">
                  <span className="catch-label">Reviews that hold up</span>
                  <span className="catch-value catch-zero">
                    {f.reviewers - f.struck}
                    <span className="catch-of"> of {f.reviewers}</span>
                  </span>
                </div>
              ) : (
                <div className="catch-num">
                  <span className="catch-label">Counted rating</span>
                  <span className="catch-value catch-real">{fmt(f.counted)}</span>
                </div>
              )}
            </div>
          </div>
          <span className="catch-go">Read the full report →</span>
        </Link>
      )}

      <section className="section" aria-labelledby="directory-title">
        <div className="section-head">
          <h2 className="section-title" id="directory-title">
            Agents with reviews
          </h2>
          <p className="section-intro">
            {dir?.latestAgentId
              ? `The most reviewed of the ${dir.scanned.toLocaleString()} newest agents, up to #${dir.latestAgentId}.`
              : "The most reviewed agents among recent registrations."}
          </p>
        </div>
        <div className="directory">
          {!dir && !dirError && (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="directory-row skeleton" />
              ))}
            </>
          )}
          {dirError && <p className="directory-status">{dirError} You can still audit an agent by number above.</p>}
          {dir && dir.agents.length === 0 && (
            <p className="directory-status">No recently registered agent has a review yet.</p>
          )}
          {dir?.agents.map((a) => {
            const pill = a.verdict ? VERDICT_PILL[a.verdict] : null;
            return (
              <Link key={a.agentId} href={`/agent/${a.agentId}`} className="directory-row">
                <span className="directory-id">#{a.agentId}</span>
                <span className={a.name ? "directory-name" : "directory-name is-empty"}>{a.name ?? "Unnamed agent"}</span>
                <span className="directory-count">
                  <span className="bar" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${(a.reviewers / max) * 100}%` }} />
                  </span>
                  <span className="directory-num">
                    {a.reviewers} {a.reviewers === 1 ? "reviewer" : "reviewers"}
                  </span>
                </span>
                <span className="directory-verdict">
                  {pill ? <span className={`pill pill-${pill.tone}`}>{pill.text}</span> : <span className="directory-go">Check →</span>}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section" aria-labelledby="method-title">
        <div className="section-head">
          <h2 className="section-title" id="method-title">
            How a review gets counted
          </h2>
          <p className="section-intro">
            ERC-8004 won&apos;t total an agent&apos;s reviews unless you hand it a list of reviewers you trust, and leaves
            that list to others. These rules build it, the same way for every agent.
          </p>
        </div>
        <ol className="method">
          <li>
            <h3>Read every reviewer</h3>
            <p>Each wallet&apos;s age, how much it does apart from reviewing, and its balance, straight from the chain.</p>
          </li>
          <li>
            <h3>Find the batches</h3>
            <p>Three or more reviewers created within 30 minutes of each other lose half their score.</p>
          </li>
          <li>
            <h3>Draw the line</h3>
            <p>A reviewer counts at 40 out of 100. The agent&apos;s own wallet never counts.</p>
          </li>
          <li>
            <h3>Recount on-chain</h3>
            <p>Average only counted reviews. The registry&apos;s own getSummary returns the same number.</p>
          </li>
        </ol>
      </section>
    </main>
  );
}
