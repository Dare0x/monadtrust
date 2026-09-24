// Network configuration for MonadTrust: Monad mainnet and testnet.
//
// Registry addresses are the canonical ERC-8004 deployments published by the
// 8004 team (github.com/erc-8004/erc-8004-contracts). Mainnet and testnet use
// different vanity addresses; both were checked with eth_getCode.

export type Net = "mainnet" | "testnet";
export const NETS_ORDER: Net[] = ["mainnet", "testnet"];
export const DEFAULT_NET: Net = "mainnet";

export interface NetConfig {
  net: Net;
  name: string;
  chainId: number;
  slug: "monad-mainnet" | "monad-testnet";
  identityRegistry: string;
  reputationRegistry: string;
  explorerAddress: string;
  explorerTx: string;
  defaultRpcs: string[];
  // Env var holding comma-separated RPC URLs to use instead (e.g. a free
  // QuickNode or Dwellir key).
  rpcEnv: string;
  // How far back the public RPC keeps state, with margin. Wallet ages beyond
  // this read as "over N days".
  windowBlocks: number;
  // Agents to scan for reviews on the directory (the newest N).
  scanSpan: number;
}

export const NETS: Record<Net, NetConfig> = {
  mainnet: {
    net: "mainnet",
    name: "Monad mainnet",
    chainId: 143,
    slug: "monad-mainnet",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    explorerAddress: "https://monadscan.com/address/",
    explorerTx: "https://monadscan.com/tx/",
    defaultRpcs: ["https://rpc.monad.xyz"],
    rpcEnv: "MONAD_MAINNET_RPC_URLS",
    // The public mainnet RPC keeps ~2.1M blocks (~7.5 days) of state.
    windowBlocks: 2_000_000,
    scanSpan: 20_000,
  },
  testnet: {
    net: "testnet",
    name: "Monad testnet",
    chainId: 10143,
    slug: "monad-testnet",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    explorerAddress: "https://testnet.monadscan.com/address/",
    explorerTx: "https://testnet.monadscan.com/tx/",
    // The official endpoint has had outages, so a second public endpoint is
    // kept as a fallback.
    defaultRpcs: ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"],
    rpcEnv: "MONAD_RPC_URLS",
    // The public testnet RPC keeps ~9M blocks; ~8M is about four weeks.
    windowBlocks: 8_000_000,
    scanSpan: 1_500,
  },
};

export function parseNet(v: string | null | undefined): Net {
  return v === "testnet" ? "testnet" : DEFAULT_NET;
}

export const APPROX_BLOCK_SECONDS = 0.3;
export const windowDays = (net: Net) => Math.round((NETS[net].windowBlocks * APPROX_BLOCK_SECONDS) / 86_400);

// Public RPC endpoints for a network, tried in order.
// `.trim() ||` rather than `??`: hosts sometimes inject empty strings.
export function rpcUrls(net: Net = DEFAULT_NET): string[] {
  const cfg = NETS[net];
  const fromEnv =
    process.env[cfg.rpcEnv]?.trim() || (net === "testnet" ? process.env.MONAD_RPC_URL?.trim() : "") || "";
  const custom = fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...custom, ...cfg.defaultRpcs.filter((d) => !custom.includes(d))];
}

// Testnet addresses under the old names, for scripts that only touch testnet.
export const ERC8004 = {
  identityRegistry: NETS.testnet.identityRegistry,
  reputationRegistry: NETS.testnet.reputationRegistry,
} as const;
export const CHAIN = {
  name: NETS.testnet.name,
  id: NETS.testnet.chainId,
  symbol: "MON",
  explorerAddress: NETS.testnet.explorerAddress,
  explorerTx: NETS.testnet.explorerTx,
} as const;
