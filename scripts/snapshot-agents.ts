// Saves the current list of reviewed agents, and audits of the most reviewed
// ones, to data/. The site shows these instantly on a cold start and refreshes
// them from the chain in the background. Re-run before deploying:
//   npm run snapshot

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditLive, scanReviewedAgents } from "../lib/service";
import type { AgentAudit } from "../lib/types";

const AUDIT_TOP = Number(process.env.AUDIT_TOP || 8);

async function main() {
  const t0 = Date.now();
  const dir = await scanReviewedAgents();
  const data = join(__dirname, "..", "data");
  writeFileSync(join(data, "agents-snapshot.json"), JSON.stringify(dir, null, 2) + "\n");
  console.log(`Saved ${dir.agents.length} agents (latest #${dir.latestAgentId}) in ${Date.now() - t0}ms`);

  const audits: Record<string, AgentAudit> = {};
  for (const a of dir.agents.filter((a) => a.reviewers >= 3).slice(0, AUDIT_TOP)) {
    const t = Date.now();
    audits[a.agentId] = await auditLive(a.agentId);
    console.log(`  #${a.agentId}: ${audits[a.agentId].verdict} in ${Date.now() - t}ms. ${audits[a.agentId].headline}`);
  }
  writeFileSync(join(data, "audits-snapshot.json"), JSON.stringify(audits) + "\n");
  console.log(`Saved ${Object.keys(audits).length} audits.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
