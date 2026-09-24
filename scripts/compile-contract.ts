// Compiles contracts/<Name>.sol with solc and writes the ABI + bytecode to
// contracts/artifacts/<Name>.json. Fully offline & reproducible.
//   npm run compile:contract -- ReviewerLists   (default: TrustRegistry)

import * as fs from "fs";
import * as path from "path";
// solc ships a bundled compiler; no download needed.
import solc from "solc";

const ROOT = path.join(__dirname, "..");
const NAME = process.argv[2] ?? "TrustRegistry";
const SRC = path.join(ROOT, "contracts", `${NAME}.sol`);
const OUT_DIR = path.join(ROOT, "contracts", "artifacts");
const OUT = path.join(OUT_DIR, `${NAME}.json`);

function main() {
  const source = fs.readFileSync(SRC, "utf8");

  const input = {
    language: "Solidity",
    sources: { [`${NAME}.sol`]: { content: source } },
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

  const contract = output.contracts[`${NAME}.sol`][NAME];
  const artifact = {
    contractName: NAME,
    compiler: "solc 0.8.24 (optimizer runs=200)",
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2));

  console.log(`✓ Compiled ${NAME}.sol`);
  console.log(`  ABI entries : ${artifact.abi.length}`);
  console.log(`  Bytecode    : ${artifact.bytecode.length} chars`);
  console.log(`  Written to  : ${path.relative(ROOT, OUT)}`);
}

main();
