// Runs the MonadTrust audit yourself, against any Monad RPC, with no server in
// between. Prints the same JSON as GET /api/v1/agents/:id (minus the on-chain
// lookup), including the counted-reviewer list you can publish yourself.
//   npm run audit -- 1924
//   MONAD_RPC_URLS=https://your-endpoint npm run audit -- 1924

import "./load-env";
import { auditLive } from "../lib/service";
import { countedReviewers } from "../lib/publicApi";

async function main() {
  const id = process.argv[2];
  if (!id || !/^\d+$/.test(id)) throw new Error("Usage: npm run audit -- <agentId>");
  const a = await auditLive(id);
  console.log(
    JSON.stringify(
      {
        agentId: a.agent.agentId,
        verdict: a.verdict,
        headline: a.headline,
        checkedAt: { block: a.asOf.block, timestamp: a.asOf.timestamp },
        auditHash: a.auditHash,
        reviewers: { total: a.totals.reviewers, counted: a.totals.counted, struck: a.totals.struck },
        countedReviewers: countedReviewers(a),
        ratings: a.tags.map((t) => ({ tag: t.tag, listed: t.listed.average, counted: t.counted.average })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
