// GET /api/agents
//
// Lists recently registered ERC-8004 agents on Monad testnet that have at least
// one review, busiest first. Cached for ten minutes: discovery reads a few
// thousand registry slots and doesn't need to be live to the second.

import { NextResponse } from "next/server";
import { featuredCatch, listReviewedAgents } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const list = await listReviewedAgents();
    const f = featuredCatch();
    const tag = f?.tags.find((t) => t.tag === f.headlineTag) ?? f?.tags[0];
    const featured =
      f && tag
        ? {
            agentId: f.agent.agentId,
            name: f.agent.card?.name ?? null,
            headline: f.headline,
            listed: tag.listed.average,
            counted: tag.counted.average,
            reviewers: f.totals.reviewers,
            struck: f.totals.struck,
            checkedAt: f.asOf.timestamp,
          }
        : null;
    return NextResponse.json({ ...list, featured }, {
      headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Couldn't read the agent registry from Monad testnet right now.", detail: (err as Error).message },
      { status: 502 }
    );
  }
}
