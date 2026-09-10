// Probe 3: find the exact earliest block with available state (pruning boundary),
// so we can bound age/recency queries honestly. Binary search the boundary.

const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const PROBE = "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e";

async function stateAvailable(block: number): Promise<boolean> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_getTransactionCount",
        params: [PROBE, "0x" + block.toString(16)],
      }),
    });
    const data = await res.json();
    return !data.error;
  } catch {
    return false;
  }
}

async function blockTimestamp(block: number): Promise<number | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_getBlockByNumber",
        params: ["0x" + block.toString(16), false],
      }),
    });
    const data = await res.json();
    return data.result ? parseInt(data.result.timestamp, 16) : null;
  } catch {
    return null;
  }
}

(async () => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const latest = parseInt((await res.json()).result, 16);
  console.log(`latest block: ${latest}`);

  // Binary search earliest available block in [latest-10M, latest].
  let lo = latest - 10_000_000; // known unavailable
  let hi = latest;              // known available
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    if (await stateAvailable(mid)) hi = mid;
    else lo = mid;
  }
  const earliest = hi;
  const blocksBack = latest - earliest;
  console.log(`earliest available block: ~${earliest}  (${blocksBack} blocks back)`);

  const tsLatest = await blockTimestamp(latest);
  const tsEarliest = await blockTimestamp(earliest);
  if (tsLatest && tsEarliest) {
    const secs = tsLatest - tsEarliest;
    console.log(`archive window spans ~${(secs / 3600).toFixed(1)} hours (${(secs / 86400).toFixed(2)} days)`);
    console.log(`=> average block time ~${(secs / blocksBack).toFixed(3)}s`);
  }
})();
