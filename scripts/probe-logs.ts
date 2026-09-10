// Probe: what does Monad testnet's public RPC actually allow for eth_getLogs?
// We need to know the max block range before ranges are rejected, and confirm
// that Transfer logs actually come back.

const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc<T>(method: string, params: unknown[]): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: `${data.error.code}: ${data.error.message}` };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

(async () => {
  const latestR = await rpc<string>("eth_blockNumber", []);
  if (!latestR.ok) { console.log("blockNumber failed:", latestR.error); return; }
  const latest = parseInt(latestR.result, 16);
  console.log(`latest block: ${latest}`);

  // 1) Does a small-range Transfer scan return ANY logs? (chain-wide, no addr filter)
  for (const span of [10, 100, 1000, 10_000, 50_000, 100_000]) {
    const from = latest - span;
    const r = await rpc<unknown[]>("eth_getLogs", [
      {
        fromBlock: "0x" + from.toString(16),
        toBlock: "0x" + latest.toString(16),
        topics: [TRANSFER_TOPIC],
      },
    ]);
    if (r.ok) {
      console.log(`span ${span.toString().padStart(7)} blocks -> OK, ${r.result.length} logs`);
    } else {
      console.log(`span ${span.toString().padStart(7)} blocks -> ERROR: ${r.error}`);
    }
  }
})();
