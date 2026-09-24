// Publishes MonadTrust's counted-reviewer lists to the ReviewerLists contract,
// so any contract can read an agent's filtered ERC-8004 rating on-chain.
//   npm run publish:lists -- mainnet            (every saved mainnet audit)
//   npm run publish:lists -- testnet 1924 1778  (fresh audits of just these agents)
//
// A list is skipped when the one on-chain already carries the same audit hash.

import "./load-env";
import * as fs from "fs";
import * as path from "path";
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { auditLive } from "../lib/service";
import { countedReviewers } from "../lib/publicApi";
import { NETS, type Net } from "../lib/chain";
import type { AgentAudit } from "../lib/types";

const ROOT = path.join(__dirname, "..");
const DEPLOYMENT = path.join(ROOT, "contracts", "reviewer-lists.json");
const ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "artifacts", "ReviewerLists.json"), "utf8")).abi;

async function main() {
  const net = process.argv[2] as Net;
  if (net !== "mainnet" && net !== "testnet") {
    throw new Error("Usage: npm run publish:lists -- <mainnet|testnet> [agentIds…]");
  }
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env.");
  const address = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"))[net]?.address;
  if (!address) throw new Error(`ReviewerLists isn't deployed on ${net} yet. Run npm run deploy:lists -- ${net} first.`);

  const provider = new JsonRpcProvider(NETS[net].defaultRpcs[0]);
  const wallet = new Wallet(pk, provider);
  const lists = new Contract(address, ABI, wallet);
  console.log(`Publisher ${wallet.address}, balance ${formatEther(await provider.getBalance(wallet.address))} MON`);

  const ids = process.argv.slice(3);
  const audits: AgentAudit[] = ids.length
    ? await Promise.all(ids.map((id) => auditLive(id, net)))
    : Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "audits-snapshot.json"), "utf8"))[net] ?? {});

  for (const a of audits) {
    const id = a.agent.agentId;
    const [, onchainHash] = await lists.getList(wallet.address, id);
    if (onchainHash === a.auditHash) {
      console.log(`#${id}: already published (audit ${a.auditHash.slice(0, 10)}…)`);
      continue;
    }
    const clients = countedReviewers(a);
    const tx = await lists.publish(id, clients, a.auditHash, a.asOf.block);
    await tx.wait();
    console.log(`#${id}: published ${clients.length} of ${a.reviewers.length} reviewers read  tx ${tx.hash}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
