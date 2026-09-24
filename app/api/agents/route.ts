// GET /api/agents
//
// Lists recently registered ERC-8004 agents on Monad testnet that have at least
// one review, busiest first, with the verdict for any agent already audited and
// the clearest current case of stuffed reviews. Served from the saved list and
// refreshed from the chain in the background.

import { NextResponse } from "next/server";
import { featuredCatch, knownAudits, listReviewedAgents } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const list = await listReviewedAgents();
    const audits = knownAudits();

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
            marks: f.reviewers.map((r) => r.counted),
          }
        : null;

    let reviewersChecked = 0;
    let struck = 0;
    for (const a of audits.values()) {
      reviewersChecked += a.totals.reviewers;
      struck += a.totals.struck;
    }

    return NextResponse.json(
      {
        ...list,
        agents: list.agents.map((a) => ({ ...a, verdict: audits.get(a.agentId)?.verdict ?? null })),
        featured,
        stats: { agentsAudited: audits.size, reviewersChecked, struck },
      },
      { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=600" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Couldn't read the agent registry from Monad testnet right now.", detail: (err as Error).message },
      { status: 502 }
    );
  }
}
