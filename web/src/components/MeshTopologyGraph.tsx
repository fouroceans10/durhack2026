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
        (p.fromPeerId === idB && p.toPeerId === idA)
    );
  };

  return (
    <section
      data-testid="mesh-topology-graph"
      className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Live P2P Mesh Topology &amp; Subgroup Clusters
          </h2>
        </div>
        <span className="text-[11px] text-slate-400">
          Click any link to sever/heal individual P2P edge
        </span>
      </div>

      <div className="relative w-full overflow-hidden rounded-lg bg-slate-950/90 border border-slate-800/70">
        <svg
          viewBox="0 0 600 360"
          className="w-full h-[290px] select-none"
          role="img"
          aria-label="P2P Mesh Topology Graph"
        >
          <defs>
            <radialGradient id="haloGroupA" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="haloGroupB" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="haloBridge" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Partitioned Subgroup Cluster Halos */}
          {modeState === "partitioned" && (
            <>
              <ellipse
                cx="145"
                cy="180"
                rx="115"
                ry="145"
                fill="url(#haloGroupA)"
                stroke="#06b6d4"
                strokeOpacity="0.35"
                strokeDasharray="6 4"
              />
              <ellipse
                cx="455"
                cy="180"
                rx="115"
                ry="145"
                fill="url(#haloGroupB)"
                stroke="#a855f7"
                strokeOpacity="0.35"
                strokeDasharray="6 4"
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
                stroke="#f59e0b"
                strokeOpacity="0.5"
                strokeWidth="1.5"
              />
              <path
                d="M 145 95 Q 300 20 455 95"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeDasharray="8 4"
              />
              <path
                d="M 145 265 Q 300 340 455 265"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeDasharray="8 4"
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
                      ? "#f43f5e"
                      : modeState === "bridging"
                      ? "#fbbf24"
                      : pulsing
                      ? "#38bdf8"
                      : "#334155"
                  }
                  strokeWidth={blocked ? 1.5 : pulsing ? 3 : 2}
                  strokeDasharray={blocked ? "5 6" : undefined}
                  strokeOpacity={blocked ? 0.45 : 0.85}
                />

                {/* Animated Packet Pulse Orb on Active Unblocked Edges */}
                {!blocked && (
                  <circle
                    cx={midX}
                    cy={midY}
                    r={pulsing ? 5 : 3}
                    fill={modeState === "bridging" ? "#fbbf24" : "#38bdf8"}
                    opacity={pulsing ? 0.95 : 0.45}
                  />
                )}

                {/* Severed Link Indicator */}
                {blocked && (
                  <g transform={`translate(${midX - 9}, ${midY - 9})`}>
                    <rect
                      width="18"
                      height="18"
                      rx="9"
                      fill="#0f172a"
                      stroke="#f43f5e"
                      strokeWidth="1.2"
                    />
                    <text
                      x="9"
                      y="12.5"
                      textAnchor="middle"
                      fill="#fb7185"
                      fontSize="10"
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
                x="-82"
                y="-28"
                width="164"
                height="56"
                rx="12"
                fill="#1e1b4b"
                stroke="#fbbf24"
                strokeWidth="2"
              />
              <text
                x="0"
                y="-6"
                textAnchor="middle"
                fill="#fde68a"
                fontSize="10"
                fontWeight="600"
              >
                PIVOT CHORD BRIDGE
              </text>
              <text
                x="0"
                y="14"
                textAnchor="middle"
                fill="#ffffff"
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
                  rx="14"
                  fill="#0f172a"
                  stroke={meta.colorHex}
                  strokeWidth={node.isLeader ? "2.4" : "1.5"}
                />

                {/* Role Title & Subgroup Leader Crown */}
                <circle cx="-88" cy="-22" r="7" fill={meta.colorHex} />
                <text
                  x="-74"
                  y="-18"
                  fill="#f8fafc"
                  fontSize="13"
                  fontWeight="bold"
                >
                  {meta.label.toUpperCase()}
                </text>

                {node.isLeader && (
                  <text
                    x="96"
                    y="-18"
                    textAnchor="end"
                    fill="#fbbf24"
                    fontSize="10"
                    fontWeight="600"
                  >
                    ★ LEADER
                  </text>
                )}

                {/* Live BPM, Key/Mode & Active Chord */}
                <text
                  x="-96"
                  y="5"
                  fill="#e2e8f0"
                  fontSize="12"
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  {node.bpm.toFixed(1)} BPM | {node.keyRoot} {node.mode} |{" "}
                  {node.chordSymbol}
                </text>

                {/* Partition Group ID */}
                <text
                  x="-96"
                  y="26"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {node.partitionGroupId.slice(0, 28)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bottom Legend */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-cyan-300">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            Active P2P DataChannel
          </span>
          <span className="inline-flex items-center gap-1 text-rose-300">
            <Scissors className="h-3.5 w-3.5 text-rose-400" />
            Severed Edge ({blockedEdges.length} blocked)
          </span>
          <span className="inline-flex items-center gap-1 text-amber-300">
            <Crown className="h-3.5 w-3.5 text-amber-400" />
            Deterministic Subgroup Leader
          </span>
        </div>

        {modeState === "bridging" && reconcilePlan && (
          <div className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
            <GitMerge className="h-3.5 w-3.5" />
            Reconciling via Pivot {reconcilePlan.pivotChord} →{" "}
            {reconcilePlan.targetKeyRoot} {reconcilePlan.targetMode}
          </div>
        )}
      </div>
    </section>
  );
};
