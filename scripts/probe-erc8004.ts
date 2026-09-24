// Live check against real Monad testnet. Prints what the app will see.
//   npm run check:live
import { scanReviewedAgents, runAudit } from "../lib/service";
import { rpcUrls } from "../lib/chain";

async function main() {
  console.log("RPC endpoints, in order:", rpcUrls().join(", "));
  let t = Date.now();
  const list = await scanReviewedAgents();
  console.log(`Latest agent: #${list.latestAgentId}. Scanned ${list.scanned} agents in ${Date.now() - t}ms.`);
  for (const a of list.agents.slice(0, 10)) console.log(`  #${a.agentId}  ${a.reviewers} reviewers  ${a.name ?? ""}`);
  const first = process.argv[2] ?? list.agents[0]?.agentId;
  if (!first) return console.log("No reviewed agents found.");
  t = Date.now();
  const audit = await runAudit(first);
  console.log(`\nAudit of #${first} took ${Date.now() - t}ms`);
  console.log(`  ${audit.headline}`);
  console.log(`  verdict: ${audit.verdict}; counted ${audit.totals.counted} of ${audit.reviewers.length} read; not read: ${audit.notAnalyzed.length}`);
  for (const tag of audit.tags) console.log(`  tag "${tag.tag}": listed ${tag.listed.average} -> counted ${tag.counted.average}`);
  const noHistory = audit.reviewers.filter((r) => r.flags.includes("history_unavailable")).length;
  if (noHistory) console.log(`  ${noHistory} reviewers had unreadable history (RPC may not keep old state)`);
}
main().catch((e) => {
  console.error("Live check failed:", e.message);
  process.exit(1);
});
