# CLAUDE.md — MonadTrust

Notes for any Claude session working in this repo. Read this first; keep it current.

## What this is
MonadTrust audits who wrote an AI agent's ERC-8004 reviews on Monad (mainnet chain 143, testnet 10143) and recomputes
the rating from reviewers that hold up. Deterministic rules, public chain data only, no model in the scoring.
Built for Monad Metropolis, Track 04: Trust, Identity & AI Infrastructure. Live: https://monadtrust.vercel.app
Sibling project: **ScopePay** (milestone escrow on Arbitrum), same author, separate repo (`dare0x/ScopePay`).

## About the builder
Dare Ayodeji: AI/data engineer and pharmacy student, based in Nigeria. Prefers plain explanations; examples from
data engineering or pharmacy land well. Strategy: ship several small, finished hackathon projects rather than one.

## Stack and commands
Next.js 15 (app router), React 19, TypeScript, ethers v6, solc for contracts. Node 18+.
- `npm test` — engine + audit rules + end-to-end against a mock RPC (offline, must pass before any push)
- `npx tsc --noEmit` — typecheck
- `npm run dev` — http://localhost:3000
- `npm run audit -- <agentId> [testnet] [--block <n>]` — reproduce an audit and its `auditHash`
- Live-chain scripts (`check:live`, `test:contract`, `test:monad`) need the public Monad RPC; they fail with HTTP 403
  from restricted sandboxes (cloud Claude sessions). Run them locally.

## Layout
`lib/` audit logic and RPC client (`audit.ts`, `erc8004.ts`, `reviewers.ts`, `rpc.ts`, `service.ts`),
`app/` pages and API routes (`/api/v1/*` public API, docs page), `contracts/` ReviewerLists.sol + TrustRegistry.sol,
`scripts/` tests and tooling, `data/` committed snapshots served instantly then refreshed live.

## Rules that must not drift
- Scoring is deterministic and model-free. The LLM (optional) only narrates facts; it must never add or change numbers.
- Audit time comes from the block being read, never the server clock, so an audit at block N always reproduces.
- Weights: age 45%, own activity 40%, balance 15%; counted at 40/100; batch and same-footprint rules halve the score;
  sample 60 evenly past 60 reviewers. If you change any of these, update README, `app/docs`, and the tests together.
- Monad's free RPC caps `eth_getLogs` at 100 blocks: use view functions and historical nonce reads, not log scans.
- Never commit keys. `.env` is for the deploy key only; `.env.example` lists variables.

## Deployed addresses
See README "Chain details" and `contracts/deployment.json` / `contracts/reviewer-lists.json` (source of truth).

## Working agreements
- Develop on the branch the session names; commit small, descriptive messages; do not open PRs unless asked.
- Honest copy: say what it can't see (README "What it can't see"). Don't overclaim in UI or docs.

## Open items / ideas
- (add here) next features, hackathon deadlines, submission checklist.
