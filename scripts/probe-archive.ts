// Probe 2: which reliable, free signals can we actually get from the public RPC?
// Decides the redesigned data layer.

const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

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

// A known-active EOA (sampled earlier) and some addresses to classify.
const EOA = "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e";
const USER = "0x309cd955024b72FA04e5b6a375F8c923b0303cF5";

(async () => {
  const latestR = await rpc<string>("eth_blockNumber", []);
  if (!latestR.ok) { console.log("blockNumber failed:", latestR.error); return; }
  const latest = parseInt(latestR.result, 16);
  console.log(`latest block: ${latest}\n`);

  // 1) Contract detection via eth_getCode
  for (const [name, a] of [["EOA-sample", EOA], ["USER", USER]] as const) {
    const r = await rpc<string>("eth_getCode", [a, "latest"]);
    console.log(`eth_getCode(${name}) -> ${r.ok ? (r.result === "0x" ? "EOA (no code)" : `CONTRACT (${r.result.length} chars)`) : "ERR " + r.error}`);
  }
  console.log("");

  // 2) Archive availability: historical nonce/balance at old blocks?
  const testBlocks = [latest - 100, latest - 100_000, latest - 1_000_000, latest - 10_000_000, 1000, 1];
  for (const b of testBlocks) {
    if (b < 0) continue;
    const bh = "0x" + b.toString(16);
    const nonce = await rpc<string>("eth_getTransactionCount", [EOA, bh]);
    const bal = await rpc<string>("eth_getBalance", [EOA, bh]);
    console.log(
      `block ${b.toString().padStart(9)}: nonce=${nonce.ok ? parseInt(nonce.result, 16) : "ERR(" + nonce.error + ")"}  balance=${bal.ok ? (Number(BigInt(bal.result)) / 1e18).toFixed(4) : "ERR(" + bal.error + ")"}`
    );
  }
})();
