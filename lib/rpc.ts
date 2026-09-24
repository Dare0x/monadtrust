// A small JSON-RPC client built for one job: making hundreds of cheap reads
// against a free public RPC without falling over.
//
//  • Requests made in the same tick are coalesced into JSON-RPC batch arrays.
//  • Reads are paced under each endpoint's per-second limit (public RPCs count
//    every call in a batch), and spread across the endpoints in the pool.
//  • If an endpoint fails, the next one is tried. If an endpoint rejects
//    batches, we fall back to single requests for it.
//  • A revert (e.g. ownerOf on a missing token) rejects only that one call and
//    is never retried; rate-limit and network errors are retried with backoff.

import { DEFAULT_NET, NETS, type Net, rpcUrls } from "./chain";

const BATCH_SIZE = 10;
const MAX_INFLIGHT = 6;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 6;

// Calls per second each endpoint accepts. The official Monad endpoint allows
// 15 and Ankr's public one 50; we stay a little under both. Anything else
// (your own QuickNode or Dwellir key) uses RPC_RATE.
function rateFor(url: string): number {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (host === "127.0.0.1" || host === "localhost") return Infinity;
  if (host.endsWith("monad.xyz")) return 12;
  if (host.endsWith("monadinfra.com")) return 12;
  if (host.endsWith("ankr.com")) return 40;
  return Number(process.env.RPC_RATE || 25);
}

// Ankr's public endpoint prunes state after about three weeks; the others we
// use keep the full window. Historical reads go only to endpoints that keep it.
function keepsHistory(url: string): boolean {
  return !/ankr\.com/.test(url);
}

interface Endpoint {
  url: string;
  archive: boolean;
  rate: number;
  tokens: number;
  refilledAt: number;
}

export class RpcRevertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRevertError";
  }
}

interface Pending {
  method: string;
  params: unknown[];
  // Needs state from weeks ago, which only archive endpoints keep.
  archive: boolean;
  attempts: number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface JsonRpcReply {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRevert(err: { code: number; message: string }): boolean {
  const m = (err.message || "").toLowerCase();
  return err.code === 3 || m.includes("revert") || m.includes("execution reverted");
}

function isRetryable(err: { code: number; message: string }): boolean {
  const m = (err.message || "").toLowerCase();
  return (
    err.code === -32005 ||
    err.code === 429 ||
    m.includes("rate") ||
    m.includes("limit") ||
    m.includes("timeout") ||
    m.includes("busy") ||
    m.includes("try again")
  );
}

export class RpcClient {
  private queue: Pending[] = [];
  private inflight = 0;
  private scheduled = false;
  private nextId = 1;
  private endpoints: Endpoint[];
  // Endpoints we pace work across. The rest are used only if these fail.
  private poolSize: number;
  private noBatch = new Set<string>();
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  readonly net: Net;

  constructor(urls?: string[], poolSize?: number, net: Net = DEFAULT_NET) {
    this.net = net;
    urls = urls ?? rpcUrls(net);
    this.endpoints = urls.map((url) => ({ url, archive: keepsHistory(url), rate: rateFor(url), tokens: 0, refilledAt: Date.now() }));
    for (const e of this.endpoints) e.tokens = Math.min(e.rate, BATCH_SIZE);
    // With your own endpoint set, it does all the work and the public ones are
    // only a fallback. With the defaults, both public endpoints share the load.
    const custom = (process.env[NETS[net].rpcEnv]?.trim() || "").split(",").filter((s) => s.trim()).length;
    this.poolSize = poolSize ?? Math.max(1, custom || urls.length);
  }

  private refill(e: Endpoint) {
    const now = Date.now();
    if (e.rate === Infinity) {
      e.tokens = BATCH_SIZE;
      return;
    }
    e.tokens = Math.min(Math.max(e.rate, BATCH_SIZE), e.tokens + ((now - e.refilledAt) / 1000) * e.rate);
    e.refilledAt = now;
  }

  call<T>(method: string, params: unknown[] = [], opts: { archive?: boolean } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        method,
        params,
        archive: opts.archive ?? false,
        attempts: 0,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.schedule();
    });
  }

  ethCall(to: string, data: string, block: string = "latest"): Promise<string> {
    return this.call<string>("eth_call", [{ to, data }, block]);
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    // A short stall lets concurrent callers join the same batch.
    setTimeout(() => {
      this.scheduled = false;
      this.pump();
    }, 4);
  }

  private pump() {
    while (this.inflight < MAX_INFLIGHT && this.queue.length > 0) {
      // First endpoint in the pool with room for at least one call it can serve.
      let pick = -1;
      let soonest = Infinity;
      const needsArchiveOnly = this.queue.every((p) => p.archive);
      for (let i = 0; i < this.poolSize; i++) {
        const e = this.endpoints[i];
        if (needsArchiveOnly && !e.archive) continue;
        this.refill(e);
        if (e.tokens >= 1) {
          pick = i;
          break;
        }
        soonest = Math.min(soonest, ((1 - e.tokens) / e.rate) * 1000);
      }
      if (pick < 0) {
        if (!this.wakeTimer) {
          this.wakeTimer = setTimeout(() => {
            this.wakeTimer = null;
            this.pump();
          }, Math.max(5, Math.ceil(Number.isFinite(soonest) ? soonest : 50)));
        }
        return;
      }
      const e = this.endpoints[pick];
      const room = Math.min(BATCH_SIZE, Math.floor(e.tokens));
      const batch: Pending[] = [];
      for (let i = 0; i < this.queue.length && batch.length < room; ) {
        if (e.archive || !this.queue[i].archive) batch.push(...this.queue.splice(i, 1));
        else i++;
      }
      e.tokens -= batch.length;
      this.inflight++;
      this.send(batch, pick).finally(() => {
        this.inflight--;
        if (this.queue.length > 0) this.pump();
      });
    }
  }

  private async send(batch: Pending[], start: number): Promise<void> {
    let lastErr: Error | null = null;
    for (let i = 0; i < this.endpoints.length; i++) {
      const e = this.endpoints[(start + i) % this.endpoints.length];
      try {
        const replies = this.noBatch.has(e.url) ? await this.postSingles(e.url, batch) : await this.postBatch(e.url, batch);
        this.settle(batch, replies, e);
        return;
      } catch (err) {
        lastErr = err as Error;
        // Rate limited at the HTTP level: give this endpoint a second's rest.
        if (/429/.test(lastErr.message)) e.tokens = Math.min(e.tokens, -e.rate);
      }
    }
    // Every endpoint failed at the transport level: retry the whole batch later.
    const retry: Pending[] = [];
    for (const p of batch) {
      p.attempts++;
      if (p.attempts >= MAX_ATTEMPTS) {
        p.reject(new Error(`Monad RPC unreachable (${p.method}): ${lastErr?.message ?? "unknown error"}`));
      } else {
        retry.push(p);
      }
    }
    if (retry.length) {
      await sleep(400 * 2 ** Math.min(4, retry[0].attempts));
      this.queue.unshift(...retry);
    }
  }

  private settle(batch: Pending[], replies: Map<number, JsonRpcReply>, endpoint: Endpoint) {
    const retry: Pending[] = [];
    let limited = false;
    batch.forEach((p, idx) => {
      const reply = replies.get(idx);
      if (!reply) {
        p.attempts++;
        if (p.attempts >= MAX_ATTEMPTS) p.reject(new Error(`No RPC reply for ${p.method}`));
        else retry.push(p);
        return;
      }
      if (reply.error) {
        if (isRevert(reply.error)) {
          p.reject(new RpcRevertError(reply.error.message));
        } else if (isRetryable(reply.error) && ++p.attempts < MAX_ATTEMPTS) {
          limited = true;
          retry.push(p);
        } else {
          p.reject(new Error(`RPC error (${p.method}): ${reply.error.message}`));
        }
        return;
      }
      p.resolve(reply.result);
    });
    // The endpoint said slow down: empty its budget so the next second is quiet.
    if (limited) endpoint.tokens = Math.min(endpoint.tokens, -endpoint.rate / 2);
    if (retry.length) {
      setTimeout(() => {
        this.queue.unshift(...retry);
        this.schedule();
      }, 500 * 2 ** Math.min(3, retry[0].attempts - 1));
    }
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 429) throw new Error("HTTP 429 rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Sends the batch as one JSON-RPC array. Replies are matched by id, since
  // servers may return them in any order. Returns index -> reply.
  private async postBatch(url: string, batch: Pending[]): Promise<Map<number, JsonRpcReply>> {
    const base = this.nextId;
    this.nextId += batch.length;
    const body = batch.map((p, i) => ({ jsonrpc: "2.0", id: base + i, method: p.method, params: p.params }));
    const data = await this.post(url, body);
    if (!Array.isArray(data)) {
      // Endpoint does not accept batches: remember that and use singles.
      this.noBatch.add(url);
      return this.postSingles(url, batch);
    }
    const out = new Map<number, JsonRpcReply>();
    for (const r of data as JsonRpcReply[]) {
      if (typeof r?.id === "number") out.set(r.id - base, r);
    }
    return out;
  }

  private async postSingles(url: string, batch: Pending[]): Promise<Map<number, JsonRpcReply>> {
    const out = new Map<number, JsonRpcReply>();
    await Promise.all(
      batch.map(async (p, i) => {
        const id = this.nextId++;
        const data = (await this.post(url, { jsonrpc: "2.0", id, method: p.method, params: p.params })) as JsonRpcReply;
        out.set(i, data);
      })
    );
    return out;
  }
}

export const hexToNumber = (hex: string): number => parseInt(hex, 16);
export const blockTag = (block: number): string => "0x" + block.toString(16);

/** A client for one network, using its configured endpoints. */
export const rpcFor = (net: Net) => new RpcClient(undefined, undefined, net);
