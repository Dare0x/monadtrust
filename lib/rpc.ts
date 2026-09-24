// A small JSON-RPC client built for one job: making hundreds of cheap reads
// against a free public RPC without falling over.
//
//  • Requests made in the same tick are coalesced into JSON-RPC batch arrays.
//  • Only a few HTTP requests are in flight at once (public RPCs rate-limit).
//  • If an endpoint fails, the next one is tried. If an endpoint rejects
//    batches, we fall back to single requests for it.
//  • A revert (e.g. ownerOf on a missing token) rejects only that one call and
//    is never retried; rate-limit and network errors are retried with backoff.

import { rpcUrls } from "./chain";

const BATCH_SIZE = 25;
const MAX_INFLIGHT = 4;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4;

export class RpcRevertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRevertError";
  }
}

interface Pending {
  method: string;
  params: unknown[];
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
  private endpoints: string[];
  private preferred = 0;
  private noBatch = new Set<string>();

  constructor(endpoints: string[] = rpcUrls()) {
    this.endpoints = endpoints;
  }

  call<T>(method: string, params: unknown[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        method,
        params,
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
      const batch = this.queue.splice(0, BATCH_SIZE);
      this.inflight++;
      this.send(batch).finally(() => {
        this.inflight--;
        if (this.queue.length > 0) this.pump();
      });
    }
  }

  private async send(batch: Pending[]): Promise<void> {
    let lastErr: Error | null = null;
    for (let i = 0; i < this.endpoints.length; i++) {
      const url = this.endpoints[(this.preferred + i) % this.endpoints.length];
      try {
        const replies = this.noBatch.has(url)
          ? await this.postSingles(url, batch)
          : await this.postBatch(url, batch);
        this.preferred = (this.preferred + i) % this.endpoints.length;
        this.settle(batch, replies);
        return;
      } catch (e) {
        lastErr = e as Error;
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
      await sleep(400 * 2 ** retry[0].attempts);
      this.queue.unshift(...retry);
    }
  }

  private settle(batch: Pending[], replies: Map<number, JsonRpcReply>) {
    const retry: Pending[] = [];
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
          retry.push(p);
        } else {
          p.reject(new Error(`RPC error (${p.method}): ${reply.error.message}`));
        }
        return;
      }
      p.resolve(reply.result);
    });
    if (retry.length) {
      setTimeout(() => {
        this.queue.unshift(...retry);
        this.schedule();
      }, 300 * 2 ** Math.min(3, retry[0].attempts));
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
