// GET /api/agent/:id
//
// Audits the reviews of ERC-8004 agent :id on Monad testnet. Reads the
// agent's feedback, reads every reviewer wallet, and returns the deterministic
// audit (lib/audit.ts) plus a plain-English summary of it.

import { NextRequest, NextResponse } from "next/server";
import { AgentNotFoundError, runAudit } from "@/lib/service";
import { explainAudit } from "@/lib/explainAudit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) {
    return NextResponse.json({ error: "Agent IDs are whole numbers, like 1924." }, { status: 400 });
  }
  try {
    const audit = await runAudit(String(BigInt(id)));
    const summary = await explainAudit(audit);
    return NextResponse.json(
      { audit, summary },
      { headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" } }
    );
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: `No agent #${id} is registered on Monad testnet.` }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "Monad testnet's public RPC didn't answer in time. Try again in a minute.",
        detail: (err as Error).message,
      },
      { status: 502 }
    );
  }
}
