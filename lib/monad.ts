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

import { RpcClient } from "./rpc";

// Stay comfortably inside the ~8.99M-block pruning boundary so historical
// reads don't fail. ~8.0M blocks ≈ 28 days of visibility, with margin.
const WINDOW_BLOCKS = 8_000_000;
// Blocks probed per search round. Each round's probes go out in one batch, so
// the search takes ~log5(8M) ≈ 10 round trips instead of ~23 sequential ones.
const PROBES_PER_ROUND = 4;

// Shared client: batches concurrent reads and falls back across public
// endpoints (see lib/rpc.ts and lib/chain.ts).
const client = new RpcClient();

function rpc<T>(method: string, params: unknown[]): Promise<T> {
  return client.call<T>(method, params);
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
    const hex = await client.call<string>("eth_getTransactionCount", [address, blockTag(block)], { archive: true });
    const n = hexToNumber(hex);
    cache.set(block, n);
    return n;
  };
}

async function blockTimestamp(block: number): Promise<number | null> {
  try {
    const b = await client.call<{ timestamp: string } | null>("eth_getBlockByNumber", [blockTag(block), false], {
      archive: true,
    });
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
 * Each round probes a few evenly spaced blocks at once and keeps the one gap
 * where the nonce crosses the target, shrinking the range ~5x per round trip.
 */
export async function firstBlockWithNonceAtLeast(
  readNonce: (b: number) => Promise<number>,
  lo: number,
  hi: number,
  target: number
): Promise<number> {
  while (lo < hi) {
    const span = hi - lo;
    const probes: number[] = [];
    for (let i = 1; i <= PROBES_PER_ROUND; i++) {
      const b = lo + Math.floor((span * i) / (PROBES_PER_ROUND + 1));
      if (b > lo && b < hi && !probes.includes(b)) probes.push(b);
    }
    if (probes.length === 0) {
      // lo and hi are adjacent.
      return (await readNonce(lo)) >= target ? lo : hi;
    }
    const nonces = await Promise.all(probes.map(readNonce));
    // First probe at or past the target bounds hi; the probe before it bounds lo.
    const k = nonces.findIndex((n) => n >= target);
    if (k === -1) {
      lo = probes[probes.length - 1] + 1;
    } else {
      hi = probes[k];
      if (k > 0) lo = probes[k - 1] + 1;
    }
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
  let lastSeenBeforeWindow = false;

  // Age/recency only make sense once the account has sent at least one tx.
  if (txCount > 0) {
    const nonceAtWindowStart = await readNonce(scannedFromBlock);

    // If the account had already reached its final nonce before our window
    // began, its most recent transaction predates what we can see — so
    // "last active" is only a lower bound (at least this long ago).
    if (nonceAtWindowStart >= txCount) lastSeenBeforeWindow = true;

    // Birth and last activity are independent searches, so run them together.
    const birth = async (): Promise<number | null> => {
      if (nonceAtWindowStart >= 1) {
        // Already active before our visible window began: age is a lower bound.
        firstSeenBeforeWindow = true;
        return blockTimestamp(scannedFromBlock);
      }
      // Born within the window: find the exact block of the first tx.
      return blockTimestamp(await firstBlockWithNonceAtLeast(readNonce, scannedFromBlock, latestBlock, 1));
    };
    // Last activity: first block that reached the current (final) nonce.
    const last = async (): Promise<number | null> =>
      lastSeenBeforeWindow
        ? blockTimestamp(scannedFromBlock)
        : blockTimestamp(await firstBlockWithNonceAtLeast(readNonce, scannedFromBlock, latestBlock, txCount));
    [firstSeen, lastSeen] = await Promise.all([birth(), last()]);
  }

  return {
    address: addr,
    isContract,
    balance,
    txCount,
    firstSeen,
    lastSeen,
    firstSeenBeforeWindow,
    lastSeenBeforeWindow,
    windowDays: Math.round((WINDOW_BLOCKS * 0.3) / 86_400),
    latestBlock,
    scannedFromBlock,
  };
}
