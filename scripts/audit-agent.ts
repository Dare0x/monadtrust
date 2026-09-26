// Runs the MonadTrust audit yourself, against any Monad RPC, with no server in
// between. Prints the same JSON as GET /api/v1/agents/:id (minus the on-chain
// lookup), including the counted-reviewer list you can publish yourself.
//   npm run audit -- 182                (Monad mainnet, latest block)
//   npm run audit -- 1924 testnet
//   npm run audit -- 182 --block 108000000   (re-run a published audit: same block, same auditHash)
//   MONAD_MAINNET_RPC_URLS=https://your-endpoint npm run audit -- 182
//
// Re-running at an old block needs an RPC that still holds that block's state;
// the public mainnet RPC keeps about six days.

import "./load-env";
import { auditLive } from "../lib/service";
import { countedReviewers } from "../lib/publicApi";
import { parseNet } from "../lib/chain";

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf("--block");
  const block = bi >= 0 ? Number(args[bi + 1]) : undefined;
  if (bi >= 0) args.splice(bi, 2);
  const [id, netArg] = args;
  if (!id || !/^\d+$/.test(id) || (block !== undefined && !Number.isInteger(block)))
    throw new Error("Usage: npm run audit -- <agentId> [mainnet|testnet] [--block <number>]");
  const net = parseNet(netArg);
  const a = await auditLive(id, net, { block });
  console.log(
    JSON.stringify(
      {
        agentId: a.agent.agentId,
        network: net,
        verdict: a.verdict,
        headline: a.headline,
        checkedAt: { block: a.asOf.block, timestamp: a.asOf.timestamp },
        auditHash: a.auditHash,
        reviewers: { total: a.totals.reviewers, read: a.reviewers.length, counted: a.totals.counted, struck: a.totals.struck },
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
