import type { Metadata } from "next";
import Link from "next/link";
import { NETS } from "@/lib/chain";
import { reviewerLists } from "@/lib/deployments";

export const metadata: Metadata = {
  title: "Docs — MonadTrust",
  description: "Use MonadTrust's counted-reviewer lists from your app, your contract, or your own machine.",
};

const MAIN = reviewerLists("mainnet");
const TEST = reviewerLists("testnet");
const LISTS = MAIN.address ?? TEST.address ?? "<ReviewerLists address>";
const PUBLISHER = MAIN.publisher ?? TEST.publisher ?? "<MonadTrust publisher>";
const RPC = MAIN.address ? NETS.mainnet.defaultRpcs[0] : NETS.testnet.defaultRpcs[0];

const RESPONSE = `{
  "agentId": "182",
  "network": "mainnet",
  "chainId": 143,
  "verdict": "inflated",
  "headline": "59 of 60 reviewer wallets hold exactly the same balance (0.002142 MON) and have made exactly 3 transactions each.",
  "checkedAt": { "block": 107551784, "timestamp": 1790236124 },
  "auditHash": "0x1e6c…204a",
  "reviewers": { "total": 7665, "read": 60, "counted": 0, "struck": 60 },
  "countedReviewers": [],
  "ratings": [
    { "tag": "eve",
      "listed":  { "average": 1.49e36, "reviews": 7662 },
      "counted": { "average": null, "reviews": 0 } }
  ],
  "onchain": {
    "reviewerLists": "${LISTS}",
    "publisher": "${PUBLISHER}",
    "list": { "published": true, "reviewers": 0, "auditHash": "0x1e6c…204a", "sourceBlock": 107551784, "publishedAt": 1790236300 }
  },
  "report": "https://monadtrust.vercel.app/agent/182"
}`;

const FETCH = `const res = await fetch("https://monadtrust.vercel.app/api/v1/agents/182");
const agent = await res.json();

if (agent.verdict === "inflated") {
  // Show the counted rating instead of the listed one, or hide the agent.
}`;

const SOLIDITY = `interface IReviewerLists {
    function getSummary(address publisher, uint256 agentId, string calldata tag1, string calldata tag2)
        external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
}

contract AgentMarketplace {
    IReviewerLists constant LISTS = IReviewerLists(${LISTS});
    address constant MONADTRUST = ${PUBLISHER};

    // Only list agents with at least 5 reviews from wallets that hold up.
    function eligible(uint256 agentId) public view returns (bool) {
        (uint64 count, , ) = LISTS.getSummary(MONADTRUST, agentId, "", "");
        return count >= 5;
    }
}`;

const CAST = `cast call ${LISTS} \\
  "getSummary(address,uint256,string,string)(uint64,int128,uint8)" \\
  ${PUBLISHER} 157 "Auction" "" \\
  --rpc-url ${RPC}`;

const SELF = `git clone https://github.com/Dare0x/monadtrust && cd monadtrust
npm install
npm run audit -- 182                  # mainnet: verdict, counted list, auditHash
npm run audit -- 1924 testnet         # testnet
MONAD_MAINNET_RPC_URLS=https://your-rpc npm run audit -- 182   # your own endpoint`;

const PUBLISH = `// Lists must be strictly ascending (no duplicates). An empty list means
// "no reviewer holds up" and is a valid answer.
await reviewerLists.publish(agentId, sortedClients, auditHash, sourceBlock);`;

export default function Docs() {
  return (
    <main className="docs">
      <header className="report-head">
        <p className="kicker">Developer docs</p>
        <h1 className="report-name">Use the counted reviewers in your own app</h1>
        <p className="report-desc">
          ERC-8004&apos;s <code>getSummary()</code> only totals reviews from a list of reviewers you pass in, because
          anyone can review an agent. MonadTrust produces that list for any agent, with open rules. You can read it
          three ways: over HTTP, from a contract, or by running the audit yourself.
        </p>
      </header>

      <nav className="docs-toc" aria-label="On this page">
        <a href="#http">HTTP API</a>
        <a href="#contract">From a contract</a>
        <a href="#self">Run it yourself</a>
        <a href="#publish">Publish your own list</a>
        <a href="#rules">Rules</a>
        <a href="#addresses">Addresses</a>
      </nav>

      <section className="block" id="http">
        <h2 className="block-title">HTTP API</h2>
        <p className="block-intro">
          No key, CORS open, JSON. Every endpoint reads Monad mainnet; add <code>?net=testnet</code> for testnet.
          Responses are cached for about a minute; the audit behind them is pinned to the block in{" "}
          <code>checkedAt</code>.
        </p>
        <dl className="endpoints">
          <dt>
            <code>GET /api/v1/agents/:id</code>
          </dt>
          <dd>One agent: verdict, counted reviewers, listed vs counted rating per tag, and what&apos;s published on-chain.</dd>
          <dt>
            <code>GET /api/v1/agents</code>
          </dt>
          <dd>Recently registered agents that have reviews, busiest first, with verdicts where known.</dd>
          <dt>
            <code>GET /api/score/:address</code>
          </dt>
          <dd>One wallet&apos;s score: age, activity, balance.</dd>
        </dl>
        <pre className="code">{FETCH}</pre>
        <p className="block-intro">Example response:</p>
        <pre className="code">{RESPONSE}</pre>
        <p className="block-intro">
          <code>verdict</code> is one of <code>organic</code>, <code>mixed</code>, <code>inflated</code>,{" "}
          <code>thin</code> (fewer than three reviewers) or <code>none</code>. When <code>reviewers.read</code> is
          less than <code>total</code>, the verdict comes from an even sample. A <code>counted.average</code> of{" "}
          <code>null</code> means no reviewer for that tag held up.
        </p>
      </section>

      <section className="block" id="contract">
        <h2 className="block-title">From a contract</h2>
        <p className="block-intro">
          MonadTrust publishes each audited agent&apos;s counted reviewers to <code>ReviewerLists</code> on Monad. Its <code>getSummary(publisher, agentId, tag1, tag2)</code> forwards that list to the ERC-8004
          Reputation Registry, so you get the filtered rating in one call. Nothing is recomputed on our side: the
          registry does the maths.
        </p>
        <pre className="code">{SOLIDITY}</pre>
        <p className="block-intro">From a terminal:</p>
        <pre className="code">{CAST}</pre>
        <p className="block-intro">
          <code>getSummary</code> returns zeros both when no reviewer held up and when nothing was published. Use{" "}
          <code>getList(publisher, agentId)</code> to tell them apart: <code>publishedAt</code> is 0 if nothing was
          published. The registry rounds its average down to the precision reviews were stored with.
        </p>
      </section>

      <section className="block" id="self">
        <h2 className="block-title">Run it yourself</h2>
        <p className="block-intro">
          You don&apos;t have to trust our server. The audit is open source and deterministic: the same block gives the
          same result and the same <code>auditHash</code>, on any machine. It only needs a Monad RPC, no keys.
        </p>
        <pre className="code">{SELF}</pre>
      </section>

      <section className="block" id="publish">
        <h2 className="block-title">Publish your own list</h2>
        <p className="block-intro">
          Anyone can publish to <code>ReviewerLists</code>; each publisher has its own lists and can&apos;t touch
          anyone else&apos;s. Run the audit with your own rules, or ours, and publish from your address. Apps then pick
          which publishers they trust. Each list records the audit hash and the block it was read at, so anyone can
          re-run the audit and check.
        </p>
        <pre className="code">{PUBLISH}</pre>
      </section>

      <section className="block" id="rules">
        <h2 className="block-title">Rules</h2>
        <p className="block-intro">Applied the same way to every agent. No AI model is involved.</p>
        <table>
          <tbody>
            <tr>
              <td>Age</td>
              <td>45% of a reviewer&apos;s score. Full marks at 14 days since its first transaction.</td>
            </tr>
            <tr>
              <td>Activity of its own</td>
              <td>40%. Transactions not spent reviewing this agent.</td>
            </tr>
            <tr>
              <td>Balance</td>
              <td>15%. Light weight, since testnet MON is free.</td>
            </tr>
            <tr>
              <td>Batches</td>
              <td>Three or more reviewers created within 30 minutes of each other lose half their score.</td>
            </tr>
            <tr>
              <td>Same footprint</td>
              <td>
                Three or more reviewers with exactly the same balance (to the wei) and the same transaction count lose
                half their score.
              </td>
            </tr>
            <tr>
              <td>Big agents</td>
              <td>Past 60 reviewers, an even sample of 60 across the order they reviewed in is read.</td>
            </tr>
            <tr>
              <td>Short history</td>
              <td>
                Wallets older than the RPC&apos;s window (about 7 days on mainnet, 28 on testnet) get age credit for the
                window only.
              </td>
            </tr>
            <tr>
              <td>Self-review</td>
              <td>The agent&apos;s own wallet never counts.</td>
            </tr>
            <tr>
              <td>Contracts</td>
              <td>Reviewers that are contracts are judged on age alone.</td>
            </tr>
            <tr>
              <td>The line</td>
              <td>A reviewer counts at 40 out of 100.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="block" id="addresses">
        <h2 className="block-title">Addresses</h2>
        {(["mainnet", "testnet"] as const).map((n) => {
          const d = reviewerLists(n);
          return (
            <dl className="facts" key={n}>
              <dt>Network</dt>
              <dd>
                {NETS[n].name} (chain {NETS[n].chainId})
              </dd>
              <dt>ReviewerLists</dt>
              <dd>{d.address ?? "not deployed yet"}</dd>
              <dt>MonadTrust publisher</dt>
              <dd>{d.publisher ?? "not deployed yet"}</dd>
              <dt>ERC-8004 Reputation Registry</dt>
              <dd>{NETS[n].reputationRegistry}</dd>
              <dt>ERC-8004 Identity Registry</dt>
              <dd>{NETS[n].identityRegistry}</dd>
            </dl>
          );
        })}
        <p className="block-intro">
          Source, tests and contract: <a href="https://github.com/Dare0x/monadtrust">github.com/Dare0x/monadtrust</a>.
          Questions or want help integrating? Open an issue there. <Link href="/">Back to agents</Link>.
        </p>
      </section>
    </main>
  );
}
