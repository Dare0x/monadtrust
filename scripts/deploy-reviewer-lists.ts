// Deploys ReviewerLists to Monad testnet, pointed at the ERC-8004 Reputation
// Registry, and records the address in contracts/reviewer-lists.json.
//   npm run compile:contract -- ReviewerLists
//   npm run deploy:lists
//
// Needs DEPLOYER_PRIVATE_KEY in .env: a throwaway testnet key with test MON
// from https://faucet.monad.xyz. Never use a key that holds real funds.

import "./load-env";
import * as fs from "fs";
import * as path from "path";
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { ERC8004 } from "../lib/chain";

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "contracts", "artifacts", "ReviewerLists.json");
const OUT = path.join(ROOT, "contracts", "reviewer-lists.json");
const RPC_URL = "https://testnet-rpc.monad.xyz";

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env.");
  const { abi, bytecode } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));

  const provider = new JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (net.chainId !== 10143n) throw new Error(`Refusing to deploy: chain ${net.chainId} is not Monad testnet (10143).`);

  const wallet = new Wallet(pk, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer ${wallet.address}, balance ${formatEther(balance)} MON`);
  if (balance === 0n) throw new Error("Deployer has no test MON. Get some at https://faucet.monad.xyz.");

  const contract = await new ContractFactory(abi, bytecode, wallet).deploy(ERC8004.reputationRegistry);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash;
  console.log(`ReviewerLists deployed at ${address}\n  tx ${txHash}\n  https://testnet.monadscan.com/address/${address}`);

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        contract: "ReviewerLists",
        chainId: 10143,
        address,
        reputationRegistry: ERC8004.reputationRegistry,
        // Lists MonadTrust itself publishes come from this address.
        publisher: wallet.address,
        txHash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
