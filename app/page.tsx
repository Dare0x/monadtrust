"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgentListing } from "@/lib/types";

interface Directory {
  latestAgentId: string | null;
  scanned: number;
  agents: AgentListing[];
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
      setFormError("Enter the agent's number from the ERC-8004 registry, like 1831.");
      return;
    }
    setFormError(null);
    router.push(`/agent/${clean}`);
  }

  const max = Math.max(1, ...(dir?.agents.map((a) => a.reviewers) ?? [1]));

  return (
    <main>
      <section className="hero">
        <h1 className="hero-title">Who wrote this agent&apos;s reviews?</h1>
        <p className="hero-lede">
          On Monad, AI agents collect reviews through ERC-8004, and any wallet can leave one. A wallet made five
          minutes ago counts the same as a customer of five months. MonadTrust checks every reviewer and recomputes
          the rating from the ones that hold up.
        </p>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            audit();
          }}
        >
          <label className="lookup-label" htmlFor="agent-id">
            Agent #
          </label>
          <input
            id="agent-id"
            className="lookup-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="1831"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <button className="button" type="submit">
            Check reviews
          </button>
        </form>
        {formError ? (
          <p className="form-error">{formError}</p>
        ) : (
          <p className="form-note">Agent numbers come from the ERC-8004 identity registry on Monad testnet.</p>
        )}
      </section>

      <section className="section" aria-labelledby="directory-title">
        <h2 className="section-title" id="directory-title">
          Agents with reviews on Monad testnet
        </h2>
        <p className="section-intro">
          {dir?.latestAgentId
            ? `Out of the ${dir.scanned.toLocaleString()} most recently registered agents (up to #${dir.latestAgentId}), these have the most reviewers.`
            : "The most reviewed agents among recent registrations."}
        </p>
        <div className="directory">
          {!dir && !dirError && <p className="directory-status">Reading the agent registry. This takes a few seconds.</p>}
          {dirError && <p className="directory-status">{dirError} You can still check an agent by number above.</p>}
          {dir && dir.agents.length === 0 && (
            <p className="directory-status">No recently registered agent has a review yet.</p>
          )}
          {dir?.agents.map((a) => (
            <Link key={a.agentId} href={`/agent/${a.agentId}`} className="directory-row">
              <span className="directory-id">#{a.agentId}</span>
              <span className={a.name ? "directory-name" : "directory-name directory-name-empty"}>
                {a.name ?? "Unnamed agent"}
              </span>
              <span className="directory-count">
                <span className="directory-track" aria-hidden="true">
                  <span className="directory-bar" style={{ width: `${(a.reviewers / max) * 100}%` }} />
                </span>
                <span className="directory-num">
                  {a.reviewers} {a.reviewers === 1 ? "reviewer" : "reviewers"}
                </span>
              </span>
              <span className="directory-go">Check</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="method-title">
        <h2 className="section-title" id="method-title">
          How a review gets counted
        </h2>
        <p className="section-intro">
          The ERC-8004 standard won&apos;t total an agent&apos;s reviews unless you give it a list of reviewers you
          trust, and it leaves that list to others. These are the rules MonadTrust uses to build one. They run in this
          order, the same way for every agent.
        </p>
        <div className="method">
          <div className="method-step">
            <h3>Read every reviewer</h3>
            <p>For each wallet that reviewed the agent: its age, how much it does apart from reviewing, and its balance.</p>
          </div>
          <div className="method-step">
            <h3>Look for batches</h3>
            <p>Three or more reviewers whose first transactions land within 30 minutes of each other lose half their score.</p>
          </div>
          <div className="method-step">
            <h3>Draw the line</h3>
            <p>A reviewer counts at 40 out of 100. The agent&apos;s own wallet never counts.</p>
          </div>
          <div className="method-step">
            <h3>Recount the rating</h3>
            <p>Average only counted reviews. It&apos;s the same number the registry returns when given that list.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
