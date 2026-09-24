// Deploys ReviewerLists to Monad, pointed at that network's ERC-8004
// Reputation Registry, and records the address in contracts/reviewer-lists.json.
//   npm run compile:contract -- ReviewerLists
//   npm run deploy:lists -- testnet
//   npm run deploy:lists -- mainnet
//
// Needs DEPLOYER_PRIVATE_KEY in .env: a throwaway key holding only a little
// MON for gas (test MON from https://faucet.monad.xyz on testnet).

import "./load-env";
import * as fs from "fs";
import * as path from "path";
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { NETS, type Net } from "../lib/chain";

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "contracts", "artifacts", "ReviewerLists.json");
const OUT = path.join(ROOT, "contracts", "reviewer-lists.json");

async function main() {
  const net = process.argv[2] as Net;
  if (net !== "mainnet" && net !== "testnet") throw new Error("Usage: npm run deploy:lists -- <mainnet|testnet>");
  const cfg = NETS[net];
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env.");
  const { abi, bytecode } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));

  const provider = new JsonRpcProvider(cfg.defaultRpcs[0]);
  const chain = await provider.getNetwork();
  if (chain.chainId !== BigInt(cfg.chainId)) {
    throw new Error(`Refusing to deploy: chain ${chain.chainId} is not ${cfg.name} (${cfg.chainId}).`);
  }

  const wallet = new Wallet(pk, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer ${wallet.address}, balance ${formatEther(balance)} MON on ${cfg.name}`);
  if (balance === 0n) throw new Error(`Deployer has no MON on ${cfg.name}.`);

  const contract = await new ContractFactory(abi, bytecode, wallet).deploy(cfg.reputationRegistry);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash;
  console.log(`ReviewerLists deployed on ${cfg.name} at ${address}`);
  console.log(`  tx ${txHash}`);
  console.log(`  ${cfg.explorerAddress}${address}`);

  const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  all[net] = {
    contract: "ReviewerLists",
    chainId: cfg.chainId,
    address,
    reputationRegistry: cfg.reputationRegistry,
    // Lists MonadTrust itself publishes come from this address.
    publisher: wallet.address,
    txHash,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
