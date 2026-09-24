// End-to-end test of the live pipeline against the local mock Monad RPC.
// Exercises the batching RPC client, ERC-8004 ABI decoding, the historical
// nonce search and the full audit, without touching the network.
//   npm run test:mock

import { startMockRpc, stats, sybils7 } from "./mock-chain";

async function main() {
  const mock = await startMockRpc();
  process.env.MONAD_RPC_URLS = mock.url;
  const { runAudit, listReviewedAgents } = await import("../lib/service");
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
  };
  try {
    const t0 = Date.now();
    const a = await runAudit("7");
    check("agent card resolved", a.agent.card?.name === "Yield Scout");
    check("all 11 reviewers read", a.reviewers.length === 11, String(a.reviewers.length));
    check("burst of 8 found", a.clusters[0]?.size === 8, JSON.stringify(a.clusters.map((c) => c.size)));
    check("3 counted", a.totals.counted === 3, String(a.totals.counted));
    check("verdict inflated", a.verdict === "inflated", a.verdict);
    check("counted average 60", a.tags[0].counted.average === 60, String(a.tags[0].counted.average));
    const sy = a.reviewers.find((r) => r.address === sybils7[0])!;
    check("sybil age from nonce search is about an hour", sy.facts.ageDays !== null && sy.facts.ageDays < 0.1, String(sy.facts.ageDays));
    check("batching used", stats.batches > 0 && stats.requests / stats.batches > 2, `${stats.requests} reads in ${stats.batches} batches`);
    console.log(`audit took ${Date.now() - t0}ms — ${a.headline}`);

    const b = await runAudit("12");
    check("organic agent verdict", b.verdict === "organic", `${b.verdict}: ${b.headline}`);

    const c = await runAudit("21");
    check("two reviewers is thin", c.verdict === "thin", c.headline);

    let missing = false;
    try {
      await runAudit("99");
    } catch (e) {
      missing = (e as Error).message.includes("not registered");
    }
    check("unknown agent is reported, not invented", missing);

    const list = await listReviewedAgents();
    check("discovery finds latest id 40", list.latestAgentId === "40", String(list.latestAgentId));
    check("discovery lists the three reviewed agents", list.agents.map((x) => x.agentId).join(",") === "7,12,21", list.agents.map((x) => `${x.agentId}:${x.reviewers}`).join(" "));
  } catch (e) {
    console.error(e);
    failures++;
  }
  mock.close();
  console.log(failures === 0 ? "\nMock RPC end-to-end passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
