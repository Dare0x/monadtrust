// Deploys TrustRegistry to Monad testnet using ethers.
//
// Requires:
//   DEPLOYER_PRIVATE_KEY  – a throwaway testnet key (see: npm run gen:wallet)
//   MONAD_RPC_URL         – optional; defaults to the public testnet RPC
//
// Safety: refuses to deploy unless connected to Monad testnet (chainId 10143)
// and the deployer has a non-zero balance. Writes the resulting address to
// contracts/deployment.json for the app and README to reference.

import * as fs from "fs";
import * as path from "path";
import { JsonRpcProvider, Wallet, ContractFactory, formatEther } from "ethers";

const MONAD_CHAIN_ID = 10143n;
const RPC_URL = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const PK = process.env.DEPLOYER_PRIVATE_KEY;

const ROOT = path.join(__dirname, "..");
const ARTIFACT = path.join(ROOT, "contracts", "artifacts", "TrustRegistry.json");
const DEPLOYMENT = path.join(ROOT, "contracts", "deployment.json");

async function main() {
  if (!PK) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is not set. Run `npm run gen:wallet`, fund it at https://faucet.monad.xyz, then add it to .env."
    );
  }
  if (!fs.existsSync(ARTIFACT)) {
    throw new Error("Artifact missing. Run `npm run compile:contract` first.");
  }

  const { abi, bytecode } = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const provider = new JsonRpcProvider(RPC_URL);

  const net = await provider.getNetwork();
  if (net.chainId !== MONAD_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: connected to chainId ${net.chainId}, expected Monad testnet ${MONAD_CHAIN_ID}.`
    );
  }

  const wallet = new Wallet(PK, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer : ${wallet.address}`);
  console.log(`Balance  : ${formatEther(balance)} MON`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 MON. Fund it with free test MON at https://faucet.monad.xyz and retry."
    );
  }

  console.log("Deploying TrustRegistry…");
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash;

  console.log(`\n✓ TrustRegistry deployed`);
  console.log(`  Address : ${address}`);
  console.log(`  Tx      : ${txHash}`);
  console.log(`  Explorer: https://testnet.monadscan.com/address/${address}`);

  fs.writeFileSync(
    DEPLOYMENT,
    JSON.stringify(
      {
        contract: "TrustRegistry",
        chain: "monad-testnet",
        chainId: Number(MONAD_CHAIN_ID),
        address,
        deployer: wallet.address,
        txHash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(`  Saved   : contracts/deployment.json`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
