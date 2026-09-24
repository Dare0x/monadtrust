"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentAudit } from "@/lib/types";

// Each reviewer wallet is one mark, placed by how long ago it made its first
// transaction (log scale, now at the right). Wallets older than the RPC's
// visible window share the zone on the left. Wallets created together show
// up as one dense spike, which is the pattern this page exists to reveal.

const TICK_TOP = 22;
const TICK_BOTTOM = 80;

function durationLabel(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(seconds / 3600);
  if (h < 48) return `${h} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export default function BirthStrip({ audit }: { audit: AgentAudit }) {
  // Draw at the real pixel width so text stays readable on phones.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth - 32)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = W < 560;
  const OLD_ZONE = compact ? 64 : 118;
  const PLOT_LEFT = OLD_ZONE + (compact ? 14 : 22);

  const maxH = audit.asOf.windowDays * 24;
  const logMax = Math.log(1 + maxH);
  const x = (ageHours: number) => PLOT_LEFT + (1 - Math.log(1 + Math.min(ageHours, maxH)) / logMax) * (W - PLOT_LEFT);

  const old = audit.reviewers.filter((r) => r.facts.ageIsLowerBound);
  const dated = audit.reviewers.filter((r) => !r.facts.ageIsLowerBound && r.facts.firstTxAt !== null);
  const unknown = audit.reviewers.length - old.length - dated.length;

  const posOf = new Map<string, number>();
  old.forEach((r, i) => posOf.set(r.address, 10 + ((i + 0.5) / Math.max(1, old.length)) * (OLD_ZONE - 20)));
  dated.forEach((r) => posOf.set(r.address, x((audit.asOf.timestamp - (r.facts.firstTxAt as number)) / 3600)));

  const axis = [
    { h: 1, label: compact ? "1 h" : "1 hour" },
    { h: 24, label: compact ? "1 d" : "1 day" },
    { h: 24 * 7, label: compact ? "1 wk" : "1 week" },
  ];

  const struckCount = audit.reviewers.filter((r) => !r.counted).length;
  const biggest = audit.clusters[0];
  const label =
    `Timeline of ${audit.reviewers.length} reviewer wallets by first transaction. ` +
    `${old.length} are older than ${audit.asOf.windowDays} days. ${struckCount} were not counted.` +
    (biggest ? ` Largest group: ${biggest.size} wallets created within ${durationLabel(biggest.end - biggest.start)}.` : "");

  return (
    <figure className="strip" ref={box}>
      <svg viewBox={`0 -30 ${W} 170`} role="img" aria-label={label}>
        {/* Older-than-window zone */}
        <rect x={0} y={TICK_TOP - 6} width={OLD_ZONE} height={TICK_BOTTOM - TICK_TOP + 12} fill="var(--surface-2)" rx={8} />
        <text x={OLD_ZONE / 2} y={TICK_BOTTOM + 26} textAnchor="middle" fontSize={compact ? 14 : 16} fill="var(--ink-2)">
          {compact ? "older" : `older than ${audit.asOf.windowDays} days`}
        </text>

        {/* Axis */}
        <line x1={PLOT_LEFT} x2={W} y1={TICK_BOTTOM + 4} y2={TICK_BOTTOM + 4} stroke="var(--rule-strong)" />
        {axis.map((a) => (
          <g key={a.label}>
            <line x1={x(a.h)} x2={x(a.h)} y1={TICK_BOTTOM + 4} y2={TICK_BOTTOM + 9} stroke="var(--rule-strong)" />
            <text x={x(a.h)} y={TICK_BOTTOM + 26} textAnchor="middle" fontSize={compact ? 14 : 16} fill="var(--ink-3)">
              {a.label}
            </text>
          </g>
        ))}
        {!compact && W - x(1) > 110 && (
          <text x={W} y={TICK_BOTTOM + 26} textAnchor="end" fontSize={16} fill="var(--ink-3)">
            now
          </text>
        )}

        {/* Burst brackets */}
        {audit.clusters.map((c, ci) => {
          const xs = c.addresses.map((a) => posOf.get(a)).filter((v): v is number => v !== undefined);
          if (xs.length === 0) return null;
          const lo = Math.min(...xs) - 5;
          const hi = Math.max(...xs) + 5;
          const mid = (lo + hi) / 2;
          const anchor = mid > W - 140 ? "end" : mid < PLOT_LEFT + 140 ? "start" : "middle";
          const tx = anchor === "end" ? hi : anchor === "start" ? lo : mid;
          return (
            <g key={c.start}>
              <path
                d={`M${lo} ${TICK_TOP - 4} V${TICK_TOP - 10} H${hi} V${TICK_TOP - 4}`}
                fill="none"
                stroke="var(--struck)"
                strokeWidth={1.5}
              />
              {ci === 0 && (
                <text x={tx} y={TICK_TOP - 17} textAnchor={anchor} fontSize={compact ? 15 : 17} fontWeight={600} fill="var(--struck)">
                  {c.size} wallets created within {durationLabel(Math.max(60, c.end - c.start))}
                </text>
              )}
            </g>
          );
        })}

        {/* One mark per reviewer */}
        {audit.reviewers.map((r) => {
          const px = posOf.get(r.address);
          if (px === undefined) return null;
          return (
            <line
              key={r.address}
              x1={px}
              x2={px}
              y1={TICK_TOP}
              y2={TICK_BOTTOM}
              stroke={r.counted ? "var(--counted)" : "var(--struck)"}
              strokeWidth={4}
              strokeLinecap="round"
              strokeOpacity={0.85}
            >
              <title>
                {r.address} — {r.counted ? "counted" : "not counted"}
              </title>
            </line>
          );
        })}
      </svg>
      <figcaption className="strip-legend">
        <span className="legend-counted">Counted reviewer</span>
        <span className="legend-struck">Not counted</span>
        {unknown > 0 && <span>{unknown} with unreadable history not shown</span>}
      </figcaption>
    </figure>
  );
}
