// Plain-English explanation of a review audit.
//
// Same integrity rule as the wallet explainer: the audit's numbers and verdict
// are computed by lib/audit.ts. This module only puts them into words. With no
// LLM key it composes a deterministic summary; with a key, a model narrates the
// facts it is given and is told not to add or change any number.

import type { AgentAudit } from "./types";

export interface AuditExplanation {
  text: string;
  source: "llm" | "fallback";
}

const fmt = (n: number | null) => (n === null ? "n/a" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function deterministicAuditExplanation(a: AgentAudit): string {
  const name = a.agent.card?.name ? `${a.agent.card.name} (agent #${a.agent.agentId})` : `Agent #${a.agent.agentId}`;
  const tag = a.tags.find((t) => t.tag === a.headlineTag);
  const parts: string[] = [];

  if (a.verdict === "none") return `${name} has no reviews on Monad testnet yet, so there is nothing to check.`;

  parts.push(`${name} has ${a.totals.reviews} review${a.totals.reviews === 1 ? "" : "s"} from ${a.totals.reviewers} wallet${a.totals.reviewers === 1 ? "" : "s"}.`);
  parts.push(a.headline);
  if (tag && tag.listed.average !== null) {
    if (tag.counted.average === null) {
      parts.push(`None of the reviewers who rated it${a.headlineTag ? ` on "${a.headlineTag}"` : ""} passed, so there is no counted rating.`);
    } else if (Math.abs(tag.listed.average - tag.counted.average) < 0.05) {
      parts.push(`Counting only established reviewers leaves the rating where it was, at ${fmt(tag.counted.average)}.`);
    } else {
      parts.push(
        `Counting only the ${a.totals.counted} reviewer${a.totals.counted === 1 ? "" : "s"} that passed moves the rating from ${fmt(
          tag.listed.average
        )} to ${fmt(tag.counted.average)}.`
      );
    }
  }
  if (a.notAnalyzed.length > 0) {
    parts.push(`${a.notAnalyzed.length} reviewer wallet${a.notAnalyzed.length === 1 ? " was" : "s were"} not read in this pass and did not count.`);
  }
  return parts.join(" ");
}

function facts(a: AgentAudit) {
  return {
    agent: { id: a.agent.agentId, name: a.agent.card?.name ?? null },
    verdict: a.verdict,
    key_finding: a.headline,
    totals: a.totals,
    rating_tag: a.headlineTag || "(untagged)",
    ratings: a.tags.map((t) => ({ tag: t.tag || "(untagged)", listed_average: t.listed.average, counted_average: t.counted.average })),
    struck_reviewer_reasons: a.reviewers.filter((r) => !r.counted).slice(0, 8).map((r) => r.reasons),
    rules: a.rules,
  };
}

const SYSTEM = [
  "You explain review audits for MonadTrust, which checks who wrote an AI agent's on-chain reviews (ERC-8004) on Monad.",
  "Every number and the verdict were already computed by deterministic code from public chain data.",
  "Explain the result for a non-expert in 2-3 short sentences.",
  "Rules: use only the facts given. Do not add, change or estimate any number. Do not accuse anyone of fraud; describe the patterns.",
  "No markdown, no lists, no emojis.",
].join("\n");

async function llm(a: AgentAudit): Promise<string | null> {
  const key = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY;
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "llama-3.1-8b-instant";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: "Explain this audit:\n" + JSON.stringify(facts(a), null, 2) },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ? text.replace(/^["'`\s]+|["'`\s]+$/g, "").slice(0, 700) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function explainAudit(a: AgentAudit): Promise<AuditExplanation> {
  const text = await llm(a);
  if (text) return { text, source: "llm" };
  return { text: deterministicAuditExplanation(a), source: "fallback" };
}
