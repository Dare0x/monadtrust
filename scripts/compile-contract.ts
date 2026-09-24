// Compiles contracts/TrustRegistry.sol with solc and writes the ABI + bytecode
// to contracts/artifacts/TrustRegistry.json. Fully offline & reproducible.

import * as fs from "fs";
import * as path from "path";
// solc ships a bundled compiler; no download needed.
import solc from "solc";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "contracts", "TrustRegistry.sol");
const OUT_DIR = path.join(ROOT, "contracts", "artifacts");
const OUT = path.join(OUT_DIR, "TrustRegistry.json");

function main() {
  const source = fs.readFileSync(SRC, "utf8");

  const input = {
    language: "Solidity",
    sources: { "TrustRegistry.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors = (output.errors ?? []).filter(
    (e: { severity: string }) => e.severity === "error"
  );
  if (errors.length > 0) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`Solidity compilation failed with ${errors.length} error(s).`);
  }
  // Surface warnings but don't fail on them.
  for (const w of output.errors ?? []) {
    if (w.severity !== "error") console.warn(w.formattedMessage);
  }

  const contract = output.contracts["TrustRegistry.sol"].TrustRegistry;
  const artifact = {
    contractName: "TrustRegistry",
    compiler: "solc 0.8.24 (optimizer runs=200)",
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2));

  console.log("✓ Compiled TrustRegistry.sol");
  console.log(`  ABI entries : ${artifact.abi.length}`);
  console.log(`  Bytecode    : ${artifact.bytecode.length} chars`);
  console.log(`  Written to  : ${path.relative(ROOT, OUT)}`);
}

main();
