// Reads the on-chain facts MonadTrust needs about each reviewer wallet.
//
// For every reviewer: balance, transaction count (nonce), whether it is a
// contract, and when it made its first transaction. The free RPC can't scan
// history, so "first transaction" is found by binary-searching the account's
// historical nonce, which only ever goes up. All reviewers are searched at the
// same time so the RPC client can batch their reads together.

import { RpcClient, blockTag, hexToNumber } from "./rpc";
import type { ReviewerSnapshot } from "./types";

export interface ChainContext {
  latestBlock: number;
  latestTimestamp: number;
  windowStart: number;
}

export async function readChainContext(rpc: RpcClient, windowBlocks: number): Promise<ChainContext> {
  const latestHex = await rpc.call<string>("eth_blockNumber");
  const latestBlock = hexToNumber(latestHex);
  const block = await rpc.call<{ timestamp: string } | null>("eth_getBlockByNumber", [blockTag(latestBlock), false]);
  return {
    latestBlock,
    latestTimestamp: block ? hexToNumber(block.timestamp) : Math.floor(Date.now() / 1000),
    windowStart: Math.max(0, latestBlock - windowBlocks),
  };
}

function makeTimestampReader(rpc: RpcClient) {
  const cache = new Map<number, Promise<number | null>>();
  return (block: number): Promise<number | null> => {
    let p = cache.get(block);
    if (!p) {
      p = rpc
        .call<{ timestamp: string } | null>("eth_getBlockByNumber", [blockTag(block), false], { archive: true })
        .then((b) => (b ? hexToNumber(b.timestamp) : null))
        .catch(() => null);
      cache.set(block, p);
    }
    return p;
  };
}

/** Smallest block in [lo, hi] where nonce >= 1. Caller guarantees nonce(hi) >= 1 and nonce(lo) = 0. */
async function firstTxBlock(rpc: RpcClient, address: string, lo: number, hi: number): Promise<number> {
  let iters = 0;
  while (lo < hi && iters++ < 40) {
    const mid = Math.floor((lo + hi) / 2);
    const n = hexToNumber(await rpc.call<string>("eth_getTransactionCount", [address, blockTag(mid)], { archive: true }));
    if (n >= 1) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

async function snapshotOne(
  rpc: RpcClient,
  address: string,
  ctx: ChainContext,
  ts: (block: number) => Promise<number | null>
): Promise<ReviewerSnapshot> {
  const latest = blockTag(ctx.latestBlock);
  const [balHex, nonceHex, code] = await Promise.all([
    rpc.call<string>("eth_getBalance", [address, latest]),
    rpc.call<string>("eth_getTransactionCount", [address, latest]),
    rpc.call<string>("eth_getCode", [address, latest]),
  ]);
  const snap: ReviewerSnapshot = {
    address,
    isContract: code !== "0x" && code !== "0x0",
    balance: Number(BigInt(balHex)) / 1e18,
    balanceWei: BigInt(balHex).toString(),
    txCount: hexToNumber(nonceHex),
    firstTxAt: null,
    firstTxBlock: null,
    firstTxBeforeWindow: false,
    historyAvailable: true,
  };
  if (snap.txCount === 0) return snap;

  try {
    const atStart = hexToNumber(
      await rpc.call<string>("eth_getTransactionCount", [address, blockTag(ctx.windowStart)], { archive: true })
    );
    if (atStart >= 1) {
      snap.firstTxBeforeWindow = true;
      return snap;
    }
    const block = await firstTxBlock(rpc, address, ctx.windowStart, ctx.latestBlock);
    snap.firstTxBlock = block;
    snap.firstTxAt = await ts(block);
    if (snap.firstTxAt === null) snap.historyAvailable = false;
  } catch {
    // The endpoint couldn't serve historical state. Say so rather than guess.
    snap.historyAvailable = false;
  }
  return snap;
}

export async function fetchReviewerSnapshots(
  rpc: RpcClient,
  addresses: string[],
  ctx: ChainContext
): Promise<{ snapshots: ReviewerSnapshot[]; failed: string[] }> {
  const ts = makeTimestampReader(rpc);
  const results = await Promise.allSettled(addresses.map((a) => snapshotOne(rpc, a, ctx, ts)));
  const snapshots: ReviewerSnapshot[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") snapshots.push(r.value);
    else failed.push(addresses[i]);
  });
  return { snapshots, failed };
}
