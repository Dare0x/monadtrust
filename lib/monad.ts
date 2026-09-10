// Reads verifiable on-chain activity for an address from Monad testnet using
// ONLY public JSON-RPC — no API key, no indexer, no cost. Free forever.
//
// Verified endpoints (docs.monad.xyz):
//   RPC:      https://testnet-rpc.monad.xyz
//   Chain ID: 10143 (0x279f)
//   Symbol:   MON
//   Explorer: https://testnet.monadscan.com
//
// Verified free-RPC constraints (probed 2026-09, see scripts/probe-*.ts):
//   • eth_getLogs is capped at a 100-block range  -> transfer history is NOT
//     obtainable for free; we do not pretend otherwise.
//   • Historical state is pruned to ~8.99M blocks (~31 days) back.
//   • Average block time ≈ 0.30s.
//
// Strategy: balance, nonce and code are read directly at the latest block.
// Account AGE and RECENCY are derived by binary-searching the historical
// account nonce (which is monotonic non-decreasing in block height) within
// the archive window. Every value is a real, reproducible chain read.

import { OnChainActivity } from "./types";

// Note the `.trim() ||` (not `??`): a deploy platform may inject this var as an
// empty string, which `??` would NOT replace — an empty RPC URL would break the
// app. Treat blank/whitespace as "not set" and fall back to the public default.
const RPC_URL =
  process.env.MONAD_RPC_URL?.trim() || "https://testnet-rpc.monad.xyz";

// Stay comfortably inside the ~8.99M-block pruning boundary so historical
// reads don't fail. ~8.0M blocks ≈ 28 days of visibility, with margin.
const WINDOW_BLOCKS = 8_000_000;
// Safety cap on binary-search iterations (log2(8M) ≈ 23).
const MAX_SEARCH_ITERS = 30;

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    // On the server we don't want Next.js caching stale chain state.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Monad RPC HTTP ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as RpcResponse<T>;
  if (data.error) {
    throw new Error(`Monad RPC error (${method}): ${data.error.message}`);
  }
  if (data.result === undefined) {
    throw new Error(`Monad RPC returned no result for ${method}`);
  }
  return data.result;
}

function hexToNumber(hex: string): number {
  return parseInt(hex, 16);
}

const blockTag = (block: number) => "0x" + block.toString(16);

// Nonce (transactions sent) for an address at a specific block height.
// Read-through cached so the two binary searches never re-fetch a height.
function makeNonceReader(address: string) {
  const cache = new Map<number, number>();
  return async (block: number): Promise<number> => {
    const hit = cache.get(block);
    if (hit !== undefined) return hit;
    const hex = await rpc<string>("eth_getTransactionCount", [
      address,
      blockTag(block),
    ]);
    const n = hexToNumber(hex);
    cache.set(block, n);
    return n;
  };
}

async function blockTimestamp(block: number): Promise<number | null> {
  try {
    const b = await rpc<{ timestamp: string } | null>("eth_getBlockByNumber", [
      blockTag(block),
      false,
    ]);
    return b ? hexToNumber(b.timestamp) : null;
  } catch {
    return null;
  }
}

/**
 * Smallest block in [lo, hi] whose nonce is >= target, assuming nonce is
 * monotonic non-decreasing. Caller guarantees nonce(hi) >= target. Used for
 * both "birth" (target=1) and "last active" (target=current nonce).
 *
 * We gallop inward from the end nearest the expected answer so the common
 * cases resolve in a handful of reads instead of a full ~23-step search:
 *   • last-active (target = current nonce): the transition sits just below
 *     `hi` for a live account, so we gallop DOWN from hi.
 *   • birth (target = 1): the transition sits near `lo`, so we gallop UP.
 * Once bracketed, we binary-search the (small) remaining interval.
 */
async function firstBlockWithNonceAtLeast(
  readNonce: (b: number) => Promise<number>,
  lo: number,
  hi: number,
  target: number,
  gallopFrom: "hi" | "lo"
): Promise<number> {
  if (gallopFrom === "hi") {
    // Find a lower bound `lo` with nonce(lo) < target by stepping down.
    let step = 1;
    let probe = hi - 1;
    while (probe > lo) {
      if ((await readNonce(probe)) < target) {
        lo = probe; // nonce(lo) < target
        break;
      }
      hi = probe; // nonce(hi) still >= target
      step *= 2;
      probe = Math.max(lo, hi - step);
    }
  } else {
    // Find an upper bound `hi` with nonce(hi) >= target by stepping up.
    let step = 1;
    let probe = lo;
    while (probe < hi) {
      if ((await readNonce(probe)) >= target) {
        hi = probe; // nonce(hi) >= target
        break;
      }
      lo = probe + 1; // nonce(lo-1) < target
      step *= 2;
      probe = Math.min(hi, lo + step);
    }
  }

  // Binary search the bracket [lo, hi] (invariant: nonce(hi) >= target).
  let iters = 0;
  while (lo < hi && iters++ < MAX_SEARCH_ITERS) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await readNonce(mid)) >= target) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

/**
 * Pulls a normalized, verifiable snapshot of on-chain activity for `address`
 * on Monad testnet. Uses direct reads (balance/nonce/code) plus a bounded
 * binary search over the historical nonce for age and recency.
 */
export async function fetchOnChainActivity(
  address: string
): Promise<OnChainActivity> {
  const addr = address.toLowerCase();

  const [balanceHex, nonceHex, code, latestHex] = await Promise.all([
    rpc<string>("eth_getBalance", [addr, "latest"]),
    rpc<string>("eth_getTransactionCount", [addr, "latest"]),
    rpc<string>("eth_getCode", [addr, "latest"]),
    rpc<string>("eth_blockNumber", []),
  ]);

  const balance = Number(BigInt(balanceHex)) / 1e18;
  const txCount = hexToNumber(nonceHex);
  const isContract = code !== "0x" && code !== "0x0";
  const latestBlock = hexToNumber(latestHex);
  const scannedFromBlock = Math.max(0, latestBlock - WINDOW_BLOCKS);

  const readNonce = makeNonceReader(addr);

  let firstSeen: number | null = null;
  let lastSeen: number | null = null;
  let firstSeenBeforeWindow = false;

  // Age/recency only make sense once the account has sent at least one tx.
  if (txCount > 0) {
    const nonceAtWindowStart = await readNonce(scannedFromBlock);

    if (nonceAtWindowStart >= 1) {
      // Already active before our visible window began: age is a lower bound.
      firstSeenBeforeWindow = true;
      firstSeen = await blockTimestamp(scannedFromBlock);
    } else {
      // Born within the window: find the exact block of the first tx.
      const birthBlock = await firstBlockWithNonceAtLeast(
        readNonce,
        scannedFromBlock,
        latestBlock,
        1,
        "lo"
      );
      firstSeen = await blockTimestamp(birthBlock);
    }

    // Last activity: first block that reached the current (final) nonce.
    const lastActiveBlock = await firstBlockWithNonceAtLeast(
      readNonce,
      scannedFromBlock,
      latestBlock,
      txCount,
      "hi"
    );
    lastSeen = await blockTimestamp(lastActiveBlock);
  }

  return {
    address: addr,
    isContract,
    balance,
    txCount,
    firstSeen,
    lastSeen,
    firstSeenBeforeWindow,
    windowDays: Math.round((WINDOW_BLOCKS * 0.3) / 86_400),
    latestBlock,
    scannedFromBlock,
  };
}
