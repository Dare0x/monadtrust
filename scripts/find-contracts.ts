import { fetchOnChainActivity } from "../lib/monad";
import { computeTrustScore } from "../lib/engine";

const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

// Find distinct `to` addresses in recent blocks that carry bytecode (contracts).
async function findContracts(count: number): Promise<string[]> {
  const latest = parseInt(await rpc<string>("eth_blockNumber", []), 16);
  const seen = new Set<string>();
  const contracts: string[] = [];
  for (let i = 0; i < 300 && contracts.length < count; i++) {
    const block = await rpc<{ transactions: { to: string | null }[] } | null>(
      "eth_getBlockByNumber",
      ["0x" + (latest - i).toString(16), true]
    );
    if (!block) continue;
    for (const tx of block.transactions) {
      if (!tx.to) continue;
      const to = tx.to.toLowerCase();
      if (seen.has(to)) continue;
      seen.add(to);
      const code = await rpc<string>("eth_getCode", [to, "latest"]);
      if (code !== "0x" && code !== "0x0") {
        contracts.push(to);
        if (contracts.length >= count) break;
      }
    }
  }
  return contracts;
}

(async () => {
  console.log("Scanning recent blocks for contract addresses...");
  const contracts = await findContracts(4);
  for (let i = 0; i < contracts.length; i++) {
    const addr = contracts[i];
    const a = await fetchOnChainActivity(addr);
    const s = computeTrustScore(a);
    console.log(
      `\n#${i + 1} ${addr}\n   contract=${a.isContract} balance=${a.balance.toFixed(
        2
      )} txCount=${a.txCount}  TRUST ${s.trustScore} [${s.band}]  flags: ${s.flags.join(", ") || "none"}`
    );
  }
})();
