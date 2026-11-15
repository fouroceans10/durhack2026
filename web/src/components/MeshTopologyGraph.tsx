import React from "react";
import { Crown, GitMerge, Network, Scissors } from "lucide-react";
import type {
  InstrumentRole,
  NetworkMode,
  ReconcilePlan,
} from "../../../shared/types";
import { normalizeEdgeKey, type PacketEdgePulseEvent } from "../net/PeerMesh";
import {
  ROLE_META,
  type InstrumentNodeTelemetry,
} from "./observatoryTypes";

export interface MeshTopologyGraphProps {
  nodes: Record<InstrumentRole, InstrumentNodeTelemetry>;
  modeState: NetworkMode;
  blockedEdges: string[];
  recentPulses: PacketEdgePulseEvent[];
  reconcilePlan: ReconcilePlan | null;
  onToggleEdgeBlock: (roleA: InstrumentRole, roleB: InstrumentRole) => void;
}

const NODE_COORDS: Record<InstrumentRole, { x: number; y: number }> = {
  drums: { x: 145, y: 95 },
  bass: { x: 145, y: 265 },
  piano: { x: 455, y: 95 },
  lead: { x: 455, y: 265 },
};

const ALL_EDGES: Array<[InstrumentRole, InstrumentRole]> = [
  ["drums", "bass"],
  ["piano", "lead"],
  ["drums", "piano"],
  ["bass", "lead"],
  ["drums", "lead"],
  ["bass", "piano"],
];

export const MeshTopologyGraph: React.FC<MeshTopologyGraphProps> = ({
  nodes,
  modeState,
  blockedEdges,
  recentPulses,
  reconcilePlan,
  onToggleEdgeBlock,
}) => {
  const blockedSet = new Set(blockedEdges);

  const isRolePairBlocked = (a: InstrumentRole, b: InstrumentRole): boolean => {
    const roleKey = normalizeEdgeKey(a, b);
    const peerKey = normalizeEdgeKey(nodes[a].peerId, nodes[b].peerId);
    return blockedSet.has(roleKey) || blockedSet.has(peerKey);
  };

  const hasRecentPulse = (a: InstrumentRole, b: InstrumentRole): boolean => {
    const idA = nodes[a].peerId;
    const idB = nodes[b].peerId;
    return recentPulses.some(
      (p) =>
        (p.fromPeerId === idA && p.toPeerId === idB) ||
        (p.fromPeerId === idB && p.toPeerId === idA),
    );
  };

  return (
    <section
      data-testid="mesh-topology-graph"
      className="border border-[var(--ink)] bg-[var(--paper-light)] p-5 flex flex-col justify-between"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 pb-2.5 border-b border-[var(--rule)]">
        <div>
          <span className="eyebrow text-[var(--red)]">
            01 — THE LIVING SCORE &amp; P2P MESH
          </span>
          <h2 className="font-display text-2xl font-medium text-[var(--ink)] mt-1 mb-0 flex items-center gap-2">
            <Network className="h-4 w-4 text-[var(--red)]" />
            Live P2P Mesh Topology &amp; Subgroup Clusters
          </h2>
        </div>
        <span className="font-mono text-[9px] tracking-wider uppercase border border-[var(--rule)] bg-[var(--paper)] px-2.5 py-1 text-[var(--muted)]">
          Click any link to sever / heal individual P2P edge
        </span>
      </div>

      <div className="relative w-full overflow-hidden bg-[var(--paper)] border border-[var(--rule)]">
        <svg
          viewBox="0 0 600 360"
          className="w-full h-[290px] select-none"
          role="img"
          aria-label="P2P Mesh Topology Graph"
        >
          <defs>
            <radialGradient id="haloGroupA" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3c5c77" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#3c5c77" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="haloGroupB" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ad3c25" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#ad3c25" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="haloBridge" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#806022" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#806022" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Subtle Classical 5-Line Staves across upper and lower systems */}
          {[75, 245].map((baseY, row) => (
            <g key={row} opacity="0.45">
              {Array.from({ length: 5 }, (_, l) => (
                <line
                  key={l}
                  x1="20"
                  x2="580"
                  y1={baseY + l * 9}
                  y2={baseY + l * 9}
                  stroke="#c7c0af"
                  strokeWidth="0.7"
                />
              ))}
            </g>
          ))}

          {/* Partitioned Subgroup Cluster Halos */}
          {modeState === "partitioned" && (
            <>
              <ellipse
                cx="145"
                cy="180"
                rx="118"
                ry="145"
                fill="url(#haloGroupA)"
                stroke="#3c5c77"
                strokeOpacity="0.5"
                strokeDasharray="5 4"
              />
              <ellipse
                cx="455"
                cy="180"
                rx="118"
                ry="145"
                fill="url(#haloGroupB)"
                stroke="#ad3c25"
                strokeOpacity="0.5"
                strokeDasharray="5 4"
              />
            </>
          )}

          {/* Bridging Golden Reconciliation Halo & Arcs */}
          {modeState === "bridging" && (
            <>
              <ellipse
                cx="300"
                cy="180"
                rx="250"
                ry="150"
                fill="url(#haloBridge)"
                stroke="#806022"
                strokeOpacity="0.55"
                strokeWidth="1.5"
              />
              <path
                d="M 145 95 Q 300 20 455 95"
                fill="none"
                stroke="#806022"
                strokeWidth="2.2"
                strokeDasharray="7 4"
              />
              <path
                d="M 145 265 Q 300 340 455 265"
                fill="none"
                stroke="#806022"
                strokeWidth="2.2"
                strokeDasharray="7 4"
              />
            </>
          )}

          {/* 6 P2P Mesh Edges */}
          {ALL_EDGES.map(([roleA, roleB]) => {
            const pA = NODE_COORDS[roleA];
            const pB = NODE_COORDS[roleB];
            const blocked = isRolePairBlocked(roleA, roleB);
            const pulsing = !blocked && hasRecentPulse(roleA, roleB);
            const midX = (pA.x + pB.x) / 2;
            const midY = (pA.y + pB.y) / 2;

            return (
              <g
                key={`${roleA}-${roleB}`}
                data-testid={`mesh-edge-${roleA}-${roleB}`}
                className="cursor-pointer"
                onClick={() => onToggleEdgeBlock(roleA, roleB)}
              >
                <line
                  x1={pA.x}
                  y1={pA.y}
                  x2={pB.x}
                  y2={pB.y}
                  stroke={
                    blocked
                      ? "#bc3824"
                      : modeState === "bridging"
                      ? "#806022"
                      : pulsing
                      ? "#3d6658"
                      : "#27251f"
                  }
                  strokeWidth={blocked ? 1.4 : pulsing ? 2.6 : 1.3}
                  strokeDasharray={blocked ? "3 8" : "3 4"}
                  strokeOpacity={blocked ? 0.55 : pulsing ? 0.9 : 0.45}
                />

                {/* Animated Packet Pulse Orb on Active Unblocked Edges */}
                {!blocked && (
                  <circle
                    cx={midX}
                    cy={midY}
                    r={pulsing ? 5 : 3}
                    fill={modeState === "bridging" ? "#806022" : "#3d6658"}
                    opacity={pulsing ? 0.95 : 0.55}
                  />
                )}

                {/* Severed Link Indicator */}
                {blocked && (
                  <g transform={`translate(${midX - 9}, ${midY - 9})`}>
                    <rect
                      width="18"
                      height="18"
                      fill="#faf6eb"
                      stroke="#bc3824"
                      strokeWidth="1.2"
                    />
                    <text
                      x="9"
                      y="13"
                      textAnchor="middle"
                      fill="#bc3824"
                      fontSize="11"
                      fontWeight="bold"
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Center Pivot Chord Badge during BRIDGING */}
          {modeState === "bridging" && reconcilePlan && (
            <g transform="translate(300, 180)">
              <rect
                x="-88"
                y="-28"
                width="176"
                height="56"
                fill="#faf6eb"
                stroke="#806022"
                strokeWidth="2"
              />
              <text
                x="0"
                y="-7"
                textAnchor="middle"
                fill="#806022"
                fontSize="9"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                PIVOT CHORD BRIDGE
              </text>
              <text
                x="0"
                y="14"
                textAnchor="middle"
                fill="#27251f"
                fontSize="13"
                fontWeight="bold"
              >
                {reconcilePlan.pivotChord} → {reconcilePlan.targetKeyRoot}{" "}
                {reconcilePlan.targetMode} ({reconcilePlan.targetBpm} BPM)
              </text>
            </g>
          )}

          {/* 4 Instrument Nodes */}
          {(["drums", "bass", "piano", "lead"] as const).map((role) => {
            const node = nodes[role];
            const pos = NODE_COORDS[role];
            const meta = ROLE_META[role];

            return (
              <g
                key={role}
                transform={`translate(${pos.x}, ${pos.y})`}
                data-testid={`mesh-node-${role}`}
              >
                <rect
                  x="-112"
                  y="-46"
                  width="224"
                  height="92"
                  fill="#faf6eb"
                  stroke={meta.colorHex}
                  strokeWidth={node.isLeader ? "2.2" : "1.2"}
                />

                {/* Top accent bar */}
                <line
                  x1="-112"
                  y1="-46"
                  x2="112"
                  y2="-46"
                  stroke={meta.colorHex}
                  strokeWidth="3.5"
                />

                {/* Role Title & Subgroup Leader Crown */}
                <circle cx="-88" cy="-22" r="6" fill={meta.colorHex} />
                <text
                  x="-74"
                  y="-18"
                  fill="#27251f"
                  fontSize="14"
                  fontWeight="600"
                >
                  {meta.label.toUpperCase()}
                </text>

                {node.isLeader && (
                  <text
                    x="96"
                    y="-18"
                    textAnchor="end"
                    fill="#bc3824"
                    fontSize="9"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="600"
                  >
                    ★ LEADER
                  </text>
                )}

                {/* Live BPM, Key/Mode & Active Chord */}
                <text
                  x="-96"
                  y="5"
                  fill="#27251f"
                  fontSize="11.5"
                  fontFamily="IBM Plex Mono, monospace"
                  fontWeight="600"
                >
                  {node.bpm.toFixed(1)} BPM | {node.keyRoot} {node.mode} |{" "}
                  {node.chordSymbol}
                </text>

                {/* Partition Group ID */}
                <text
                  x="-96"
                  y="26"
                  fill="#706b5e"
                  fontSize="9.5"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {node.partitionGroupId.slice(0, 28)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Legend */}
      <div className="mt-3 pt-2.5 border-t border-[var(--rule)] flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-[var(--muted)]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-[var(--woodwinds)]">
            <span className="h-2 w-2 rounded-full bg-[var(--woodwinds)]" />
            Active P2P DataChannel
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--red)]">
            <Scissors className="h-3.5 w-3.5 text-[var(--red)]" />
            Severed Edge ({blockedEdges.length} blocked)
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--ink)]">
            <Crown className="h-3.5 w-3.5 text-[var(--red)]" />
            Deterministic Subgroup Leader
          </span>
        </div>

        {modeState === "bridging" && reconcilePlan && (
          <div className="inline-flex items-center gap-1.5 text-[var(--brass)] font-semibold">
            <GitMerge className="h-3.5 w-3.5" />
            Reconciling via Pivot {reconcilePlan.pivotChord} →{" "}
            {reconcilePlan.targetKeyRoot} {reconcilePlan.targetMode}
          </div>
        )}
      </div>
    </section>
  );
};
