// Multicall3 lets one eth_call run many view calls. Public RPCs rate-limit by
// request, so reading 1,500 registry slots this way takes a handful of
// requests instead of 1,500. Deployed at the same address on nearly every EVM
// chain, including Monad testnet.

import { Interface } from "ethers";
import type { RpcClient } from "./rpc";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const multicallAbi = new Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

export interface Call {
  target: string;
  data: string;
}

// Runs every call and returns its raw return data, or null where that one
// call reverted. A transport or RPC failure rejects the whole thing, so the
// caller never mistakes "couldn't read" for "empty".
export async function multicall(rpc: RpcClient, calls: Call[], chunkSize = 200): Promise<(string | null)[]> {
  const chunks: Call[][] = [];
  for (let i = 0; i < calls.length; i += chunkSize) chunks.push(calls.slice(i, i + chunkSize));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const data = multicallAbi.encodeFunctionData("aggregate3", [
        chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.data })),
      ]);
      const raw = await rpc.ethCall(MULTICALL3, data);
      const [out] = multicallAbi.decodeFunctionResult("aggregate3", raw);
      return (out as { success: boolean; returnData: string }[]).map((r) => (r.success ? r.returnData : null));
    })
  );
  return results.flat();
}
