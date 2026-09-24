// Generates a fresh, throwaway deployer wallet for Monad TESTNET only.
//
// Why a throwaway key: deploying a contract requires signing a transaction,
// which needs a private key in the environment. We NEVER use a real,
// value-holding wallet for this. This wallet exists only to deploy on testnet,
// funded by the free faucet. Do not send real assets to it, ever.

import { Wallet } from "ethers";

const w = Wallet.createRandom();

console.log("── Throwaway Monad TESTNET deployer wallet ──────────────────");
console.log(`Address     : ${w.address}`);
console.log(`Private key : ${w.privateKey}`);
console.log("");
console.log("Next steps:");
console.log("  1. Add the private key to .env as:");
console.log(`       DEPLOYER_PRIVATE_KEY=${w.privateKey}`);
console.log("  2. Fund the ADDRESS above with free test MON:");
console.log("       https://faucet.monad.xyz");
console.log("  3. Run:  npm run deploy:contract");
console.log("");
console.log("⚠  Testnet only. Never fund this with real assets.");
