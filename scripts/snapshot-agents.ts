// Saves the current list of reviewed agents to data/agents-snapshot.json.
// The site shows this copy instantly on a cold start, then refreshes it from
// the chain in the background. Re-run before deploying: npm run snapshot

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanReviewedAgents } from "../lib/service";

async function main() {
  const t0 = Date.now();
  const dir = await scanReviewedAgents();
  const out = join(__dirname, "..", "data", "agents-snapshot.json");
  writeFileSync(out, JSON.stringify(dir, null, 2) + "\n");
  console.log(`Saved ${dir.agents.length} agents (latest #${dir.latestAgentId}) in ${Date.now() - t0}ms to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
