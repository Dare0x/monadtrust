// Chain configuration for MonadTrust (Monad testnet).
//
// Registry addresses are the canonical ERC-8004 deployments published by the
// 8004 team (github.com/erc-8004/erc-8004-contracts). The same CREATE2 vanity
// addresses are used on every testnet, so these are not guesses.

export const CHAIN = {
  name: "Monad testnet",
  id: 10143,
  symbol: "MON",
  explorerAddress: "https://testnet.monadscan.com/address/",
  explorerTx: "https://testnet.monadscan.com/tx/",
} as const;

export const ERC8004 = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const;

// Public RPC endpoints, tried in order. The official endpoint has had outages,
// so a second public endpoint is kept as a fallback. Set MONAD_RPC_URLS (comma
// separated) to use your own, e.g. a free QuickNode or Dwellir key.
// `.trim() ||` rather than `??`: hosts sometimes inject empty strings.
export function rpcUrls(): string[] {
  const fromEnv =
    process.env.MONAD_RPC_URLS?.trim() || process.env.MONAD_RPC_URL?.trim() || "";
  const custom = fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"];
  return [...custom, ...defaults.filter((d) => !custom.includes(d))];
}

// The free RPC prunes historical state to roughly the last ~9M blocks. We stay
// inside that with margin. At ~0.3s blocks this is about four weeks.
export const WINDOW_BLOCKS = 8_000_000;
export const APPROX_BLOCK_SECONDS = 0.3;
export const WINDOW_DAYS = Math.round((WINDOW_BLOCKS * APPROX_BLOCK_SECONDS) / 86_400);
