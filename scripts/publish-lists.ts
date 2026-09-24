// Publishes MonadTrust's counted-reviewer lists to the ReviewerLists contract,
// so any contract can read an agent's filtered ERC-8004 rating on-chain.
//   npm run publish:lists              (every agent in data/audits-snapshot.json)
//   npm run publish:lists -- 1924 1778 (fresh audits of just these agents)
//
// A list is skipped when the one on-chain already carries the same audit hash.

import "./load-env";
import * as fs from "fs";
import * as path from "path";
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { auditLive } from "../lib/service";
import type { AgentAudit } from "../lib/types";

const ROOT = path.join(__dirname, "..");
const DEPLOYMENT = path.join(ROOT, "contracts", "reviewer-lists.json");
const ABI = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "artifacts", "ReviewerLists.json"), "utf8")).abi;

export function countedList(a: AgentAudit): string[] {
  return a.reviewers
    .filter((r) => r.counted)
    .map((r) => r.address.toLowerCase())
    .sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
}

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env.");
  if (!fs.existsSync(DEPLOYMENT)) throw new Error("ReviewerLists isn't deployed yet. Run npm run deploy:lists first.");
  const { address } = JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));

  const provider = new JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new Wallet(pk, provider);
  const lists = new Contract(address, ABI, wallet);
  console.log(`Publisher ${wallet.address}, balance ${formatEther(await provider.getBalance(wallet.address))} MON`);

  const ids = process.argv.slice(2);
  const audits: AgentAudit[] = ids.length
    ? await Promise.all(ids.map((id) => auditLive(id)))
    : Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "audits-snapshot.json"), "utf8")));

  for (const a of audits) {
    const id = a.agent.agentId;
    const [, onchainHash] = await lists.getList(wallet.address, id);
    if (onchainHash === a.auditHash) {
      console.log(`#${id}: already published (audit ${a.auditHash.slice(0, 10)}…)`);
      continue;
    }
    const clients = countedList(a);
    const tx = await lists.publish(id, clients, a.auditHash, a.asOf.block);
    await tx.wait();
    console.log(`#${id}: published ${clients.length} of ${a.reviewers.length} reviewers  tx ${tx.hash}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
