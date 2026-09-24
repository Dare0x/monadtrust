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

// Collect several DISTINCT sender addresses from recent blocks, so we can
// see the score behave across a variety of real accounts.
async function sampleAddresses(count: number): Promise<string[]> {
  const latest = parseInt(await rpc<string>("eth_blockNumber", []), 16);
  const found = new Set<string>();
  for (let i = 0; i < 200 && found.size < count; i++) {
    const bn = "0x" + (latest - i).toString(16);
    const block = await rpc<{ transactions: { from: string }[] } | null>(
      "eth_getBlockByNumber",
      [bn, true]
    );
    if (block) for (const tx of block.transactions) found.add(tx.from.toLowerCase());
  }
  return [...found].slice(0, count);
}

async function report(label: string, address: string) {
  console.log(`\n=== ${label}: ${address} ===`);
  const t0 = Date.now();
  try {
    const a = await fetchOnChainActivity(address);
    const ms = Date.now() - t0;
    const score = computeTrustScore(a);
    console.log(`  fetched in ${ms}ms  | contract=${a.isContract}`);
    console.log(
      `  balance=${a.balance.toFixed(3)} MON  txCount=${a.txCount}  windowDays=${a.windowDays}`
    );
    const fs = a.firstSeen ? new Date(a.firstSeen * 1000).toISOString().slice(0, 10) : "null";
    const ls = a.lastSeen ? new Date(a.lastSeen * 1000).toISOString().slice(0, 10) : "null";
    console.log(`  firstSeen=${fs}${a.firstSeenBeforeWindow ? " (≥, pre-window)" : ""}  lastSeen=${ls}`);
    console.log(
      `  --> TRUST ${score.trustScore} [${score.band}]  flags: ${score.flags.join(", ") || "none"}`
    );
    for (const m of score.metrics) {
      console.log(`        ${m.label.padEnd(18)} ${m.value.toFixed(0).padStart(3)}  (${m.raw})`);
    }
  } catch (err) {
    console.log(`  ERROR: ${(err as Error).message}`);
  }
}

(async () => {
  console.log("Sampling real active addresses from recent Monad blocks...");
  const samples = await sampleAddresses(3);
  for (let i = 0; i < samples.length; i++) {
    await report(`Sampled address #${i + 1}`, samples[i]);
  }
  await report("User-provided address", "0x309cd955024b72FA04e5b6a375F8c923b0303cF5");
})();
