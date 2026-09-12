// GET /api/score/:address
//
// Validates the address, reads verifiable on-chain activity from Monad
// testnet, and returns a deterministic trust score. No secrets, no API keys,
// no external services — just public RPC. Every field in the response is
// reproducible by anyone with the same RPC endpoint.

import { NextRequest, NextResponse } from "next/server";
import { fetchOnChainActivity } from "@/lib/monad";
import { computeTrustScore } from "@/lib/engine";

// Always run fresh — chain state changes constantly, never cache a score.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json(
      {
        error:
          "Invalid address. Expected a 42-character hex address like 0x1234…abcd.",
      },
      { status: 400 }
    );
  }

  try {
    const activity = await fetchOnChainActivity(address);
    const result = computeTrustScore(activity);
    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    // Surface the failure honestly instead of inventing a score.
    return NextResponse.json(
      {
        error:
          "Could not read this address from Monad testnet right now. The public RPC may be busy — please try again.",
        detail: (err as Error).message,
      },
      { status: 502 }
    );
  }
}
