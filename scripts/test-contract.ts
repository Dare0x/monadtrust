// Tests ReviewerLists against the real ERC-8004 Reputation Registry on Monad
// testnet without spending anything. A throwaway harness contract is "deployed"
// inside a single eth_call: its constructor creates ReviewerLists, publishes
// lists, reads them back and returns the results. Nothing is written on-chain.
//   npm run test:contract

import * as fs from "fs";
import * as path from "path";
import solc from "solc";
import { AbiCoder, Interface } from "ethers";
import { RpcClient } from "../lib/rpc";
import { ERC8004 } from "../lib/chain";

const ROOT = path.join(__dirname, "..");

const HARNESS = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "ReviewerLists.sol";

contract Harness {
    constructor(address registry, uint256 agentId, address[] memory clients, string memory tag) {
        ReviewerLists r = new ReviewerLists(registry);

        r.publish(agentId, clients, bytes32(uint256(0xabc)), 123);
        (uint64 c, int128 v, uint8 d) = r.getSummary(address(this), agentId, tag, "");
        (address[] memory got, bytes32 h, uint64 src, uint64 pub) = r.getList(address(this), agentId);

        // Another publisher's view of the same agent is untouched.
        (uint64 cOther, , ) = r.getSummary(address(0xdead), agentId, tag, "");

        // An empty list is a valid answer and reads as zero.
        r.publish(agentId, new address[](0), bytes32(0), 124);
        (uint64 cEmpty, , ) = r.getSummary(address(this), agentId, tag, "");

        // Unsorted or duplicate lists are rejected.
        address[] memory bad = new address[](2);
        bad[0] = address(2);
        bad[1] = address(1);
        bool unsortedRejected;
        try r.publish(agentId, bad, bytes32(0), 0) { unsortedRejected = false; } catch { unsortedRejected = true; }
        bad[0] = address(1);
        bool dupRejected;
        try r.publish(agentId, bad, bytes32(0), 0) { dupRejected = false; } catch { dupRejected = true; }

        bytes memory out = abi.encode(c, v, d, got.length, h, src, pub > 0, cOther, cEmpty, unsortedRejected, dupRejected);
        assembly { return(add(out, 32), mload(out)) }
    }
}`;

function compile() {
  const input = {
    language: "Solidity",
    sources: {
      "ReviewerLists.sol": { content: fs.readFileSync(path.join(ROOT, "contracts", "ReviewerLists.sol"), "utf8") },
      "Harness.sol": { content: HARNESS },
    },
    // viaIR only because the harness constructor juggles many locals.
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errs.length) throw new Error(errs.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  return "0x" + out.contracts["Harness.sol"].Harness.evm.bytecode.object;
}

async function main() {
  const rpc = new RpcClient(undefined, undefined, "testnet");
  const coder = AbiCoder.defaultAbiCoder();
  const bytecode = compile();
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
  };

  // Agent #1778 (Beta Agent): four reviewers, all counted by the audit.
  const agentId = 1778n;
  const audits = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "audits-snapshot.json"), "utf8"));
  const clients: string[] = [...audits.testnet["1778"].onchainCheck.clientAddresses].sort((a: string, b: string) =>
    BigInt(a) < BigInt(b) ? -1 : 1
  );
  const tag = audits.testnet["1778"].onchainCheck.tag1;

  // What the registry itself says for the same list.
  const reg = new Interface([
    "function getSummary(uint256,address[],string,string) view returns (uint64,int128,uint8)",
  ]);
  const direct = reg.decodeFunctionResult(
    "getSummary",
    await rpc.ethCall(ERC8004.reputationRegistry, reg.encodeFunctionData("getSummary", [agentId, clients, tag, ""]))
  );

  const args = coder.encode(["address", "uint256", "address[]", "string"], [ERC8004.reputationRegistry, agentId, clients, tag]);
  const raw = await rpc.call<string>("eth_call", [{ data: bytecode + args.slice(2), gas: "0x1c9c380" }, "latest"]);
  const [c, v, d, n, h, src, published, cOther, cEmpty, unsortedRejected, dupRejected] = coder.decode(
    ["uint64", "int128", "uint8", "uint256", "bytes32", "uint64", "bool", "uint64", "uint64", "bool", "bool"],
    raw
  );

  check("summary matches the registry", c === direct[0] && v === direct[1] && d === direct[2], `${c} reviews, value ${v}, decimals ${d}`);
  check("list stored in full", Number(n) === clients.length, String(n));
  check("audit hash and source block stored", BigInt(h) === 0xabcn && src === 123n);
  check("publishedAt set", published === true);
  check("other publishers unaffected", cOther === 0n);
  check("empty list reads as zero", cEmpty === 0n);
  check("unsorted list rejected", unsortedRejected === true);
  check("duplicate reviewer rejected", dupRejected === true);

  if (failures) {
    console.error(`\n${failures} contract check(s) failed.`);
    process.exit(1);
  }
  console.log("\nReviewerLists checks passed against the live registry.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
