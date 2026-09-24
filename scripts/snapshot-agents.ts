// Saves the list of reviewed agents, and audits of the most reviewed ones, for
// each network to data/. The site shows these instantly on a cold start and
// refreshes them from the chain in the background. Re-run before deploying:
//   npm run snapshot                 (both networks)
//   npm run snapshot -- mainnet      (one network)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditLive, scanReviewedAgents } from "../lib/service";
import { NETS_ORDER, type Net } from "../lib/chain";
import type { AgentAudit } from "../lib/types";

const AUDIT_TOP = Number(process.env.AUDIT_TOP || 8);
const DATA = join(__dirname, "..", "data");

function load(file: string) {
  try {
    return JSON.parse(readFileSync(join(DATA, file), "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const nets = (process.argv.slice(2).filter((a) => a === "mainnet" || a === "testnet") as Net[]).length
    ? (process.argv.slice(2) as Net[])
    : NETS_ORDER;
  const agentsOut = load("agents-snapshot.json");
  const auditsOut = load("audits-snapshot.json");

  for (const net of nets) {
    const t0 = Date.now();
    const dir = await scanReviewedAgents(net);
    agentsOut[net] = dir;
    console.log(`[${net}] ${dir.agents.length} reviewed agents of ${dir.scanned} scanned (latest #${dir.latestAgentId}) in ${Date.now() - t0}ms`);

    const audits: Record<string, AgentAudit> = {};
    for (const a of dir.agents.filter((a) => a.reviewers >= 3).slice(0, AUDIT_TOP)) {
      const t = Date.now();
      try {
        audits[a.agentId] = await auditLive(a.agentId, net);
        console.log(`  #${a.agentId}: ${audits[a.agentId].verdict} in ${Date.now() - t}ms. ${audits[a.agentId].headline}`);
      } catch (e) {
        console.log(`  #${a.agentId}: failed (${(e as Error).message.slice(0, 80)})`);
      }
    }
    auditsOut[net] = audits;
    writeFileSync(join(DATA, "agents-snapshot.json"), JSON.stringify(agentsOut, null, 2) + "\n");
    writeFileSync(join(DATA, "audits-snapshot.json"), JSON.stringify(auditsOut) + "\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
