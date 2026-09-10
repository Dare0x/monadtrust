# MonadTrust

**A transparent, reproducible reputation score for any wallet or agent on Monad.**

Paste an address → MonadTrust reads its on-chain history and returns a 0–100
trust score with a full, human-readable breakdown of *why*. Every input is a
public on-chain fact that anyone can independently verify. There is no black
box, no proprietary data, and **no AI model that invents or adjusts the
number** — the score is computed by a small, open, deterministic engine.

Built for Monad testnet · reads via public JSON-RPC · free to run · MIT-licensed.

---

## Why this exists

On-chain agents and wallets are just addresses. Before you transact with one —
or let your own agent transact with it — you want a cheap, trustless signal:
*is this a real, established, actively-used account, or something created five
minutes ago?*

Most "reputation" tools answer this with a hidden model and a data pipeline you
have to trust. For a **trust** product, that's backwards. MonadTrust takes the
opposite stance:

- **Only verifiable inputs.** We read balance, transaction count, code, and
  historical nonce directly from the chain. If we can't verify it for free, we
  don't claim it.
- **Deterministic scoring.** Same chain state in → same score out, for anyone
  running the code. No randomness, no LLM in the scoring path.
- **Radical honesty about limits.** We show exactly which blocks we inspected
  and state plainly what the free RPC does *not* let us see.

That honesty is the product.

---

## How the score works

The engine ([`lib/engine.ts`](lib/engine.ts)) combines four verifiable signals
into a weighted 0–100 score:

| Metric | Weight | What it measures | Source |
| --- | --- | --- | --- |
| **Account age** | 30% | How long the account has been active | Binary search over historical nonce |
| **Activity level** | 30% | Total transactions sent (log-scaled) | `eth_getTransactionCount` |
| **Recent activity** | 25% | How recently it last transacted | Binary search over historical nonce |
| **Native balance** | 15% | Skin in the game (weighted *lightly* — testnet MON is free) | `eth_getBalance` |

The result is bucketed into a band — **High** (≥70), **Medium** (≥40),
**Low** (<40), or **New** (no outbound history) — and annotated with
deterministic flags such as `very_new`, `dormant`, `contract`, and
`high_volume_automated`.

### The clever bit: age & recency without an indexer

Monad's free public RPC caps `eth_getLogs` at a **100-block range**, so scanning
transfer history is impossible for free. Instead, we exploit the fact that an
account's **nonce is monotonic** in block height: we **binary-search** (with an
exponential "gallop" to accelerate the common cases) for the block where the
nonce first became non-zero (birth) and where it reached its current value (last
activity). This yields real, exact age and recency in ~a dozen RPC reads —
no paid indexer, no API key. See [`lib/monad.ts`](lib/monad.ts).

### What we deliberately don't claim

The same free-RPC limit means we **cannot** cheaply see full token or
counterparty history, and historical state is pruned to roughly the last
**~28 days**. So MonadTrust does not pretend to compute "diversity" metrics from
data it can't fetch. Age for older accounts is reported as a **lower bound**
(`≥ N days`). The UI states all of this in plain language on every result.

**MonadTrust measures how established and consistently active an address is —
nothing more.** A high score is not a guarantee of honesty; a "new" score is not
an accusation.

---

## On-chain trust registry

[`contracts/TrustRegistry.sol`](contracts/TrustRegistry.sol) is a minimal,
dependency-free, permissionless contract that anchors scores on-chain so other
contracts and agents can consume them:

- `attest(subject, score, band, metricsHash)` records an attestation under
  `msg.sender`'s namespace and emits an append-only `Attested` event.
- `metricsHash` is a `keccak256` commitment to the exact metric breakdown that
  produced the score, so any attestation is **tamper-evident**: re-run the open
  engine, recompute the hash, and verify.
- No owner, no admin, no upgrade key. Readers choose which attester to trust.

This makes a MonadTrust score a portable, composable, verifiable identity
primitive rather than a number that lives only in one website.

---

## Run it locally

Requirements: Node 18+.

```bash
npm install
npm run dev
# open http://localhost:3000
```

That's it — the web app needs **no configuration** and **no API keys**. It uses
the public Monad testnet RPC out of the box.

### Verify the engine and the live reader

```bash
npm run test:engine   # deterministic scoring over fixtures
npm run test:monad    # reads real addresses from live Monad testnet
```

### Compile & deploy the contract (optional)

```bash
npm run compile:contract          # solc -> contracts/artifacts/TrustRegistry.json
npm run gen:wallet                # make a throwaway TESTNET deployer key
# fund the printed address at https://faucet.monad.xyz, add the key to .env
npm run deploy:contract           # deploys to Monad testnet, writes deployment.json
```

---

## Project layout

```
app/
  page.tsx                    # UI: search, score gauge, metric breakdown, honesty panel
  api/score/[address]/route.ts# GET /api/score/:address -> deterministic JSON score
lib/
  monad.ts                    # public-RPC reader (balance, nonce, code, nonce binary search)
  engine.ts                   # deterministic scoring engine (no LLM, no invented numbers)
  types.ts                    # shared types
contracts/
  TrustRegistry.sol           # on-chain, tamper-evident attestation registry
scripts/
  test-engine.ts  test-monad.ts  compile-contract.ts  deploy-contract.ts  gen-wallet.ts
```

## Chain details (Monad testnet)

- RPC: `https://testnet-rpc.monad.xyz` · Chain ID: `10143` · Symbol: `MON`
- Explorer: `https://testnet.monadscan.com` · Faucet: `https://faucet.monad.xyz`

## Roadmap

- Wallet-connected "attest on-chain" button (write a score via your own wallet).
- Read and display existing on-chain attestations for an address.
- Optional AI layer that *explains* a score in plain English — strictly on top
  of the deterministic number, never producing it.

## Disclaimer

MonadTrust is an informational tool for a testnet. Scores are not financial
advice and not a proof of honesty or identity. Always do your own research.

## License

[MIT](LICENSE).
