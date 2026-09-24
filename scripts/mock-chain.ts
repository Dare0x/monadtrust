// A small in-memory stand-in for Monad testnet's JSON-RPC, used by tests and
// for previewing the UI offline. It serves only the calls MonadTrust makes.
//   npm run mock:rpc   (then MONAD_RPC_URLS=http://127.0.0.1:8545 npm run dev)

import http from "node:http";
import { AbiCoder, Interface } from "ethers";

export const LATEST = 45_000_000;
const GENESIS_TS = 1_775_000_000;
const tsOf = (b: number) => GENESIS_TS + Math.floor(b * 0.3);
export const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const HOUR_BLOCKS = 12_000; // 3600 / 0.3
const DAY_BLOCKS = HOUR_BLOCKS * 24;

type Wallet = { born: number; nonce: number; bal: bigint; contract?: boolean };
export const wallets = new Map<string, Wallet>();
type Fb = { c: string; v: number; tag: string };
export const agents = new Map<bigint, { owner: string; card: string; feedback: Fb[] }>();
export const MAX_AGENT = BigInt(40);

const card = (name: string, description: string) =>
  "data:application/json;base64," + Buffer.from(JSON.stringify({ name, description })).toString("base64");

// Agent 7: three real users and eight wallets made together an hour ago.
export const honest7 = [1, 2, 3].map(addr);
honest7.forEach((a, i) => wallets.set(a, { born: 1_000_000 + i, nonce: 80 + i * 30, bal: BigInt(2e18) }));
export const sybils7 = Array.from({ length: 8 }, (_, i) => addr(0x100 + i));
sybils7.forEach((a, i) => wallets.set(a, { born: LATEST - HOUR_BLOCKS + i * 40, nonce: 1, bal: BigInt(2e16) }));
agents.set(BigInt(7), {
  owner: addr(0xaaa),
  card: card("Yield Scout", "Finds the best stablecoin yield on Monad and rebalances daily."),
  feedback: [...honest7.map((c, i) => ({ c, v: [60, 55, 65][i], tag: "starred" })), ...sybils7.map((c) => ({ c, v: 100, tag: "starred" }))],
});

// Agent 12: organic, reviewers arriving over weeks.
const organic = Array.from({ length: 9 }, (_, i) => addr(0x200 + i));
const bornDaysAgo = [40, 35, 30, 21, 14, 9, 6, 3, 1.5];
organic.forEach((a, i) =>
  wallets.set(a, { born: LATEST - Math.floor(bornDaysAgo[i] * DAY_BLOCKS), nonce: 20 + i * 11, bal: BigInt(Math.round((0.6 + i * 0.4) * 1e18)) })
);
agents.set(BigInt(12), {
  owner: addr(0xbbb),
  card: card("Ledger Clerk", "Reconciles a DAO treasury against its on-chain payments."),
  feedback: organic.map((c, i) => ({ c, v: [82, 90, 75, 88, 70, 92, 85, 78, 80][i], tag: "starred" })),
});

// Agent 21: two reviewers only.
agents.set(BigInt(21), {
  owner: addr(0xccc),
  card: card("Gas Oracle", "Predicts the next block's base fee."),
  feedback: [organic[0], organic[1]].map((c) => ({ c, v: 90, tag: "starred" })),
});

const identity = new Interface([
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function getAgentWallet(uint256) view returns (address)",
]);
const reputation = new Interface(["function getClients(uint256) view returns (address[])"]);
const multicall = new Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

function handle(method: string, params: unknown[]): { result?: unknown; error?: unknown } {
  const blockOf = (tag: unknown) => (tag === "latest" ? LATEST : parseInt(String(tag), 16));
  const revert = { error: { code: 3, message: "execution reverted" } };
  switch (method) {
    case "eth_blockNumber":
      return { result: "0x" + LATEST.toString(16) };
    case "eth_getBlockByNumber":
      return { result: { timestamp: "0x" + tsOf(blockOf(params[0])).toString(16) } };
    case "eth_getBalance":
      return { result: "0x" + (wallets.get(String(params[0]).toLowerCase())?.bal ?? BigInt(0)).toString(16) };
    case "eth_getCode":
      return { result: wallets.get(String(params[0]).toLowerCase())?.contract ? "0x6080" : "0x" };
    case "eth_getTransactionCount": {
      const w = wallets.get(String(params[0]).toLowerCase());
      const b = blockOf(params[1]);
      if (!w || b < w.born) return { result: "0x0" };
      const n = b >= LATEST ? w.nonce : Math.min(w.nonce, 1 + Math.floor((b - w.born) / 100_000));
      return { result: "0x" + n.toString(16) };
    }
    case "eth_call": {
      const { to, data } = params[0] as { to: string; data: string };
      const t = to.toLowerCase();
      if (t === "0xca11bde05977b3631167028862be2a173976ca11") {
        const [calls] = multicall.decodeFunctionData("aggregate3", data);
        const out = (calls as { target: string; callData: string }[]).map((c) => {
          const r = handle("eth_call", [{ to: c.target, data: c.callData }]);
          return r.error ? { success: false, returnData: "0x" } : { success: true, returnData: r.result as string };
        });
        return { result: multicall.encodeFunctionResult("aggregate3", [out]) };
      }
      if (t === "0x8004a818bfb912233c491871b3d84c89a494bd9e") {
        const tx = identity.parseTransaction({ data })!;
        const id = tx.args[0] as bigint;
        if (id > MAX_AGENT) return revert;
        const ag = agents.get(id);
        const owner = ag?.owner ?? addr(0xddd);
        if (tx.name === "ownerOf") return { result: identity.encodeFunctionResult("ownerOf", [owner]) };
        if (tx.name === "tokenURI") return { result: identity.encodeFunctionResult("tokenURI", [ag?.card ?? ""]) };
        if (tx.name === "getAgentWallet") return { result: identity.encodeFunctionResult("getAgentWallet", [owner]) };
      }
      if (t === "0x8004b663056a597dffe9eccc1965a193b7388713") {
        const sel = data.slice(0, 10);
        const id = BigInt("0x" + data.slice(10, 74));
        const list = agents.get(id)?.feedback ?? [];
        if (sel === reputation.getFunction("getClients")!.selector) {
          return { result: reputation.encodeFunctionResult("getClients", [[...new Set(list.map((f) => f.c))]]) };
        }
        return {
          result: AbiCoder.defaultAbiCoder().encode(
            ["address[]", "uint64[]", "int128[]", "uint8[]", "string[]", "string[]", "bool[]"],
            [list.map((f) => f.c), list.map(() => 1), list.map((f) => f.v), list.map(() => 0), list.map((f) => f.tag), list.map(() => ""), list.map(() => false)]
          ),
        };
      }
      return revert;
    }
  }
  return { error: { code: -32601, message: "method not found" } };
}

export const stats = { requests: 0, batches: 0 };

export function startMockRpc(port = 0): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const one = (r: { id: number; method: string; params: unknown[] }) => {
        stats.requests++;
        return { jsonrpc: "2.0", id: r.id, ...handle(r.method, r.params) };
      };
      const out = Array.isArray(parsed) ? (stats.batches++, parsed.map(one)) : one(parsed);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      const p = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${p}`, close: () => server.close() });
    })
  );
}

if (process.argv[1]?.endsWith("mock-chain.ts")) {
  startMockRpc(Number(process.env.PORT || 8545)).then(({ url }) => console.log(`Mock Monad RPC on ${url}`));
}
