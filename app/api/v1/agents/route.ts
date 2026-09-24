// GET /api/v1/agents — recently registered agents that have reviews, with the
// verdict for any agent already checked. See /docs.

import { NextRequest, NextResponse } from "next/server";
import { NETS, parseNet } from "@/lib/chain";
import { knownAudits, listReviewedAgents } from "@/lib/service";
import { CORS } from "@/lib/publicApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  try {
    const list = await listReviewedAgents(net);
    const audits = knownAudits(net);
    return NextResponse.json(
      {
        network: net,
        chainId: NETS[net].chainId,
        latestAgentId: list.latestAgentId,
        scanned: list.scanned,
        updatedAt: list.updatedAt,
        agents: list.agents.map((a) => {
          const au = audits.get(a.agentId);
          return {
            agentId: a.agentId,
            name: a.name,
            reviewers: a.reviewers,
            verdict: au?.verdict ?? null,
            counted: au?.totals.counted ?? null,
          };
        }),
      },
      { headers: { ...CORS, "cache-control": "public, s-maxage=60, stale-while-revalidate=600" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't read the agent registry right now." }, { status: 502, headers: CORS });
  }
}
