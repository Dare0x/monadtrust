// MonadTrust — score explanation layer.
//
// IMPORTANT INTEGRITY RULE: the trust score is computed *entirely* by the
// deterministic engine (lib/engine.ts). This module NEVER produces or alters
// that number. It only turns an already-computed result into plain English.
//
//   • If an LLM API key is configured, we ask a model to *narrate* the score
//     (source: "llm"). The model is explicitly forbidden from proposing a
//     different number, and we ignore any number it emits — the UI always
//     shows our deterministic score, not the model's text-as-truth.
//   • If no key is set, or the call fails/times out, we fall back to a
//     deterministic, template-composed summary (source: "fallback"). We do
//     NOT call that "AI" in the UI. It always works and costs nothing.
//
// This keeps MonadTrust free-forever and never-breaks, while letting the demo
// show genuine AI when a (free) key is present.

import type { TrustScoreResult } from "@/lib/types";

export type ExplanationSource = "llm" | "fallback";

export interface Explanation {
  text: string;
  source: ExplanationSource;
}

const BAND_PHRASE: Record<TrustScoreResult["band"], string> = {
  high: "a strong, well-established on-chain history",
  medium: "a moderate on-chain history",
  low: "a limited on-chain history",
  new: "little to no outbound on-chain history yet",
};

const BAND_LABEL: Record<TrustScoreResult["band"], string> = {
  high: "High trust",
  medium: "Medium trust",
  low: "Low trust",
  new: "New / unproven",
};

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/**
 * Deterministic, template-composed explanation. Always available, always free.
 * Reads only from the already-computed result — invents nothing.
 */
export function deterministicExplanation(r: TrustScoreResult): string {
  const s = r.activitySummary;
  const noun = r.isContract ? "contract" : "wallet";
  const parts: string[] = [];

  parts.push(
    `${shortAddr(r.address)} scores ${r.trustScore}/100 (${BAND_LABEL[r.band]}), reflecting ${BAND_PHRASE[r.band]}.`
  );

  // Factual middle sentence built from what we actually measured.
  if (s.txCount === 0) {
    parts.push(
      `This ${noun} has sent no outbound transactions in the visible history, so there is little to score yet.`
    );
  } else {
    const bits: string[] = [];
    bits.push(`${s.txCount.toLocaleString()} transaction${s.txCount === 1 ? "" : "s"} sent`);
    if (s.ageDays !== null) {
      bits.push(`${s.ageIsLowerBound ? "at least " : ""}${s.ageDays} day${s.ageDays === 1 ? "" : "s"} of activity`);
    }
    if (s.lastActiveDays !== null) {
      bits.push(
        s.lastActiveDays < 1
          ? "active today"
          : `last active ${s.lastActiveDays} day${s.lastActiveDays === 1 ? "" : "s"} ago`
      );
    }
    parts.push(`It shows ${bits.join(", ")}.`);
  }

  // One concrete, honest "what would raise it" lever from the weakest metric.
  parts.push(raiseTip(r));

  return parts.join(" ");
}

function raiseTip(r: TrustScoreResult): string {
  const s = r.activitySummary;
  if (s.txCount === 0) {
    return "Sending real transactions from this address is what would start building a track record.";
  }
  if (r.flags.includes("dormant")) {
    return "More recent transactions would raise the score, since activity has gone quiet.";
  }
  // Pick the weakest of the improvable levers (ignore balance — testnet MON is free).
  const levers = r.metrics
    .filter((m) => m.key === "age" || m.key === "activity" || m.key === "recency")
    .sort((a, b) => a.value - b.value);
  const weakest = levers[0];
  if (weakest && weakest.value >= 80) {
    return "It is already strong across these signals; sustained, consistent activity will keep it there.";
  }
  if (weakest?.key === "age") return "A longer, consistent history over time would raise the score.";
  if (weakest?.key === "activity") return "More transaction activity would raise the score.";
  if (weakest?.key === "recency") return "More recent transactions would raise the score.";
  return "Sustained, consistent activity over time is what raises the score.";
}

/** Compact, safe projection of the result for the LLM prompt. */
function promptFacts(r: TrustScoreResult) {
  return {
    address: r.address,
    score_out_of_100: r.trustScore,
    band: r.band,
    is_contract: r.isContract,
    transactions_sent: r.activitySummary.txCount,
    age_days: r.activitySummary.ageDays,
    age_is_lower_bound: r.activitySummary.ageIsLowerBound,
    last_active_days_ago: r.activitySummary.lastActiveDays,
    balance_mon: r.activitySummary.balance,
    flags: r.flags,
    metrics: r.metrics.map((m) => ({ name: m.label, subscore_0_100: Math.round(m.value), raw: m.raw })),
  };
}

const SYSTEM_PROMPT = [
  "You explain wallet/agent trust scores for MonadTrust, a tool on the Monad blockchain.",
  "The score and every metric were already computed deterministically from public on-chain data.",
  "Your ONLY job is to explain the given result in plain, neutral English for a non-expert.",
  "Hard rules:",
  "- Do NOT invent facts that are not in the provided data.",
  "- Do NOT propose a different score or suggest the number is wrong; treat it as final and correct.",
  "- A high score is NOT proof of honesty; a 'new' score is NOT an accusation. Never imply otherwise.",
  "- Write 2–3 short sentences. End with one concrete thing that would raise the score.",
  "- No markdown, no headers, no emojis. Just the sentences.",
].join("\n");

/**
 * LLM narration via any OpenAI-compatible chat endpoint (default: Groq's free
 * tier). Returns null on any problem so the caller can fall back cleanly.
 */
export async function llmExplanation(r: TrustScoreResult): Promise<string | null> {
  const apiKey = process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "llama-3.1-8b-instant";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              "Explain this trust score result:\n" + JSON.stringify(promptFacts(r), null, 2),
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    // Clamp length defensively; strip stray surrounding quotes/markdown.
    return text.replace(/^["'`\s]+|["'`\s]+$/g, "").slice(0, 600);
  } catch {
    return null; // timeout, network, parse — fall back silently
  } finally {
    clearTimeout(timeout);
  }
}

/** Preferred entry point: real AI when configured, deterministic otherwise. */
export async function buildExplanation(r: TrustScoreResult): Promise<Explanation> {
  const llm = await llmExplanation(r);
  if (llm) return { text: llm, source: "llm" };
  return { text: deterministicExplanation(r), source: "fallback" };
}
