// GET /api/v1/agents/:id — the stable public API for one agent. See /docs.

import { NextRequest, NextResponse } from "next/server";
import { AgentNotFoundError, runAudit } from "@/lib/service";
import { CORS, agentV1 } from "@/lib/publicApi";
import { NETS, parseNet } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const net = parseNet(req.nextUrl.searchParams.get("net"));
  if (!/^\d{1,12}$/.test(id)) {
    return NextResponse.json({ error: "Agent IDs are whole numbers, like 1924." }, { status: 400, headers: CORS });
  }
  try {
    const audit = await runAudit(String(BigInt(id)), net);
    return NextResponse.json(await agentV1(audit, net, req.nextUrl.origin), {
      headers: { ...CORS, "cache-control": "public, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: `No agent #${id} is registered on ${NETS[net].name}.` }, { status: 404, headers: CORS });
    }
    return NextResponse.json(
      { error: `${NETS[net].name}'s public RPC didn't answer in time. Try again in a minute.` },
      { status: 502, headers: CORS }
    );
  }
}
