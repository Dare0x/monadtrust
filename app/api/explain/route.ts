// POST /api/explain
//
// Body: a TrustScoreResult (as returned by /api/score/:address).
// Returns: { text, source } where source is "llm" (a real model narrated the
// score) or "fallback" (deterministic template — always free, never fails).
//
// This endpoint NEVER computes or changes a score. It only explains one that
// was already computed by the deterministic engine. See lib/explain.ts.

import { NextRequest, NextResponse } from "next/server";
import { buildExplanation } from "@/lib/explain";
import type { TrustScoreResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BANDS = new Set(["high", "medium", "low", "new"]);

// Light structural validation of the fields the explainer actually reads, so a
// malformed body yields a clean 400 rather than a 500.
function isScoreResult(v: unknown): v is TrustScoreResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const a = r.activitySummary as Record<string, unknown> | undefined;
  return (
    typeof r.address === "string" &&
    typeof r.trustScore === "number" &&
    typeof r.band === "string" &&
    BANDS.has(r.band) &&
    typeof r.isContract === "boolean" &&
    Array.isArray(r.flags) &&
    Array.isArray(r.metrics) &&
    typeof a === "object" &&
    a !== null &&
    typeof a.txCount === "number"
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  if (!isScoreResult(body)) {
    return NextResponse.json(
      { error: "Body must be a trust score result (from /api/score)." },
      { status: 400 }
    );
  }

  try {
    const explanation = await buildExplanation(body);
    return NextResponse.json(explanation, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    // Never fail the request over an explanation — degrade to a factual note.
    return NextResponse.json(
      { text: "This score reflects the address's verifiable on-chain history.", source: "fallback" },
      { status: 200 }
    );
  }
}
