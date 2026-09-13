import { computeTrustScore } from "../lib/engine";
import { OnChainActivity } from "../lib/types";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;

function activity(over: Partial<OnChainActivity>): OnChainActivity {
  return {
    address: "0xTEST",
    isContract: false,
    balance: 1,
    txCount: 0,
    firstSeen: null,
    lastSeen: null,
    firstSeenBeforeWindow: false,
    lastSeenBeforeWindow: false,
    windowDays: 28,
    latestBlock: 61_000_000,
    scannedFromBlock: 53_000_000,
    ...over,
  };
}

// Established: active before our window began, busy, recently active.
const established = activity({
  txCount: 240,
  firstSeen: now - 28 * DAY,
  firstSeenBeforeWindow: true,
  lastSeen: now - 1 * DAY,
  balance: 5,
});

// Brand-new wallet created today with a couple of txns.
const fresh = activity({
  txCount: 3,
  firstSeen: now - 1 * DAY,
  lastSeen: now - 1 * DAY,
  balance: 0.5,
});

// Dormant: was active, but idle for 20 days.
const dormant = activity({
  txCount: 60,
  firstSeen: now - 27 * DAY,
  firstSeenBeforeWindow: true,
  lastSeen: now - 20 * DAY,
  balance: 2,
});

// Contract / on-chain agent (has bytecode, low outbound nonce).
const contract = activity({
  isContract: true,
  txCount: 0,
  balance: 3,
});

// High-volume automated/system address.
const highVolume = activity({
  txCount: 5_000_000,
  firstSeen: now - 28 * DAY,
  firstSeenBeforeWindow: true,
  lastSeen: now - 0.2 * DAY,
  balance: 0.5,
});

// Old account whose ENTIRE history predates our visible window, so both age
// and last-active are lower bounds. Exercises the "≥ Nd ago" honesty path.
const preWindow = activity({
  txCount: 1,
  firstSeen: now - 28 * DAY,
  firstSeenBeforeWindow: true,
  lastSeen: now - 28 * DAY,
  lastSeenBeforeWindow: true,
  balance: 0,
});

// Empty address: nothing on chain at all.
const empty = activity({ balance: 0 });

for (const [name, a] of [
  ["Established (pre-window, busy, live)", established],
  ["Fresh (created today)", fresh],
  ["Dormant (idle 20d)", dormant],
  ["Contract / agent (bytecode)", contract],
  ["High-volume automated", highVolume],
  ["Pre-window (all history older than window)", preWindow],
  ["Empty (no activity)", empty],
] as const) {
  const r = computeTrustScore(a, name);
  console.log(`\n=== ${name} ===`);
  console.log(`Trust score: ${r.trustScore}  [band: ${r.band}]`);
  console.log(`Flags: ${r.flags.join(", ") || "none"}`);
  for (const m of r.metrics) {
    console.log(
      `  ${m.label.padEnd(20)} ${m.value.toFixed(0).padStart(3)}  (${m.raw})`
    );
  }
}
console.log("");
