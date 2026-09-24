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
        <p className="eyebrow">
          <span className="net-dot" aria-hidden="true" />
          ERC-8004 review audit · live on Monad testnet
        </p>
        <h1 className="hero-title">
          Every agent has reviews. <span className="grad">Not every review is real.</span>
        </h1>
        <p className="hero-lede">
          Any wallet can rate an agent, and a wallet made a minute ago counts the same as a customer of five months.
          MonadTrust checks every reviewer and recomputes the rating from the ones that hold up.
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
            Audit reviews
          </button>
        </form>
        {formError ? (
          <p className="form-error">{formError}</p>
        ) : (
          <p className="form-note">Agent numbers come from the ERC-8004 identity registry.</p>
        )}

        <dl className="stats">
          <div>
            <dt>Agents scanned</dt>
            <dd>{dir ? dir.scanned.toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt>With reviews</dt>
            <dd>{dir ? dir.agents.length : "—"}</dd>
          </div>
          <div>
            <dt>Reviewers checked</dt>
            <dd>{dir ? dir.stats.reviewersChecked : "—"}</dd>
          </div>
          <div>
            <dt>Reviews struck</dt>
            <dd className="stat-bad">{dir ? dir.stats.struck : "—"}</dd>
          </div>
        </dl>
      </section>

      {f && (
        <Link href={`/agent/${f.agentId}`} className="catch" aria-labelledby="catch-title">
          <div className="catch-body">
            <p className="catch-kicker">
              <span className="pulse" aria-hidden="true" />
              Caught on-chain · checked {ago(f.checkedAt)}
            </p>
            <h2 className="catch-title" id="catch-title">
              {f.name ?? `Agent #${f.agentId}`}: {f.struck} of {f.reviewers} reviews don&apos;t hold up
            </h2>
            <p className="catch-headline">{f.headline}</p>
            <div className="dots" aria-label={`${f.reviewers - f.struck} counted, ${f.struck} struck`}>
              {f.marks.map((ok, i) => (
                <span key={i} className={ok ? "dot dot-good" : "dot dot-bad"} />
              ))}
            </div>
          </div>
          <div className="catch-score">
            <div className="catch-num">
              <span className="catch-label">Listed</span>
              <span className="catch-value catch-listed">{fmt(f.listed)}</span>
            </div>
            <span className="catch-arrow" aria-hidden="true">
              →
            </span>
            {f.counted === null ? (
              <div className="catch-num">
                <span className="catch-label">Hold up</span>
                <span className="catch-value catch-zero">
                  {f.reviewers - f.struck}
                  <span className="catch-of">/{f.reviewers}</span>
                </span>
              </div>
            ) : (
              <div className="catch-num">
                <span className="catch-label">Real</span>
                <span className="catch-value catch-real">{fmt(f.counted)}</span>
              </div>
            )}
            <span className="catch-go">Open the report →</span>
          </div>
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
                  {pill ? <span className={`pill pill-${pill.tone}`}>{pill.text}</span> : <span className="pill pill-ghost">Audit</span>}
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
        <div className="method">
          <div className="method-step">
            <span className="method-n">01</span>
            <h3>Read every reviewer</h3>
            <p>Each wallet&apos;s age, how much it does apart from reviewing, and its balance, straight from the chain.</p>
          </div>
          <div className="method-step">
            <span className="method-n">02</span>
            <h3>Find the batches</h3>
            <p>Three or more reviewers created within 30 minutes of each other lose half their score.</p>
          </div>
          <div className="method-step">
            <span className="method-n">03</span>
            <h3>Draw the line</h3>
            <p>A reviewer counts at 40 out of 100. The agent&apos;s own wallet never counts.</p>
          </div>
          <div className="method-step">
            <span className="method-n">04</span>
            <h3>Recount on-chain</h3>
            <p>Average only counted reviews. The registry&apos;s own getSummary returns the same number.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
