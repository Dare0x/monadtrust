# MonadTrust

**Who wrote this agent's reviews?**

AI agents on Monad collect reviews through [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), and any wallet can
leave one. A wallet made five minutes ago counts the same as a customer of five months. MonadTrust checks every
reviewer of an agent and recomputes the rating from the ones that hold up, using only public chain data.

Built for Monad Metropolis, Track 04: Trust, Identity & AI Infrastructure.

## The gap in ERC-8004 this fills

The standard is open about it. Its reputation registry's `getSummary()` refuses to run without a list of reviewer
addresses, because *"results without filtering by clientAddresses are subject to Sybil/spam attacks"*, and its
security section says it expects others to build reputation systems for reviewers. It doesn't say where that list
comes from.

MonadTrust produces that list, for any agent, with rules anyone can read and re-run. The page shows the rating the
registry returns when given the list, plus the exact call so anyone (or any contract) can reproduce it on-chain.

## How a review gets counted

For each wallet that reviewed the agent, read from Monad testnet's public RPC:

| Signal | Weight | Source |
| --- | --- | --- |
| Age: time since its first transaction (full marks at 14 days) | 45% | binary search over the wallet's historical nonce |
| Activity of its own: transactions *not* spent reviewing this agent | 40% | `eth_getTransactionCount` minus its reviews |
| Balance (light weight: testnet MON is free) | 15% | `eth_getBalance` |

Then:

- **Batches.** Three or more reviewers whose first transactions fall within 30 minutes of each other lose half their
  score. Real customers arrive over weeks; wallets made to leave reviews arrive together.
- **Self-review.** The agent's own wallet never counts.
- **The line.** A reviewer counts at 40/100.
- **The recount.** The counted rating averages only counted reviews, per ERC-8004 tag. It equals
  `getSummary(agentId, countedReviewers, tag, "")`.

Contracts that post reviews (for example a game contract rating the agents that played it) are judged by age alone,
since a contract's nonce doesn't reflect use.

No model is involved in any of this. Time comes from the block being read, not the server clock, so the same block
always gives the same audit, and each audit carries a fingerprint (`auditHash`) of its result.

## AI that explains, never scores

The report ends with a plain-English summary. With no key it is composed by fixed rules. With a free
OpenAI-compatible key (`LLM_API_KEY`, e.g. Groq), a model narrates the facts it is given and is told not to add or
change any number. The page says which of the two wrote it.

## Why no indexer

Monad's free RPC caps `eth_getLogs` at 100 blocks, so event history can't be scanned for free. Everything here uses
view functions (`readAllFeedback`, `getClients`, `ownerOf`, `tokenURI`) and historical `eth_getTransactionCount`,
batched through a small JSON-RPC client that paces itself under each endpoint's rate limit and sends historical
reads only to endpoints that keep that history (`lib/rpc.ts`). Agent discovery reads 1,500 registry slots in a
handful of Multicall3 calls. An agent with 60 reviewers takes a few hundred reads.

## What it can't see

- History older than the RPC keeps (about four weeks) reads as "over 28 days".
- Who funded a wallet. Wallets paid by one person look independent unless they were created together.
- A patient attacker can age wallets and give them activity. These rules make fake reviews slower and more
  expensive, not impossible.

## Run it

Requires Node 18+. No keys, no configuration.

```bash
npm install
npm run dev          # http://localhost:3000
```

Other commands:

```bash
npm test             # scoring engine, audit rules, and a full end-to-end run against a mock Monad RPC
npm run check:live   # read the real ERC-8004 registries on Monad testnet and audit the busiest agent
npm run mock:rpc     # offline mock chain; then MONAD_RPC_URLS=http://127.0.0.1:8545 npm run dev
npm run snapshot     # save the agent list and audits of the busiest agents to data/ (served instantly, refreshed live)
```

Optional environment variables (see `.env.example`): `MONAD_RPC_URLS` (comma-separated, e.g. a free QuickNode or
Dwellir endpoint), `LLM_API_KEY`, `MAX_REVIEWERS` (default 60), `SCAN_SPAN` (default 1500).

## API

- `GET /api/agent/:id` — the audit for one agent, plus its plain-English summary.
- `GET /api/agents` — recently registered agents that have reviews, busiest first.
- `GET /api/score/:address` — the single-wallet check (the original MonadTrust score).

## Layout

```
lib/
  audit.ts         deterministic review audit (the rules above)
  erc8004.ts       reads the ERC-8004 identity and reputation registries
  reviewers.ts     reads reviewer wallets: balance, nonce, first transaction
  rpc.ts           batching JSON-RPC client with fallback and retries
  service.ts       runs an audit end to end; agent discovery
  explainAudit.ts  plain-English summary (rules or LLM; never numbers)
  engine.ts        single-wallet score
components/BirthStrip.tsx   timeline of when each reviewer wallet was created
app/                        pages and API routes
contracts/TrustRegistry.sol attestation registry, deployed on Monad testnet
scripts/                    tests, mock chain, live check
```

## Chain details

- Monad testnet, chain ID 10143. RPC `https://testnet-rpc.monad.xyz` (fallback `https://rpc.ankr.com/monad_testnet`).
- ERC-8004 IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- MonadTrust TrustRegistry `0xD276995C889D6A42343E699009F419C9d4B3AdB9`

## License

[MIT](LICENSE). A counted review is not proof of honesty, and a struck one is not an accusation.
