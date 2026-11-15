import React from "react";
import { CheckCircle2, Disc, Timer } from "lucide-react";
import type { InstrumentRole, NetworkMode } from "../../../shared/types";
import {
  ROLE_META,
  type InstrumentNodeTelemetry,
} from "./observatoryTypes";

export interface BeatPhaseRingProps {
  nodes: Record<InstrumentRole, InstrumentNodeTelemetry>;
  modeState: NetworkMode;
  phaseErrorMs: number;
  barNumber: number;
}

const BEAT_LABELS: Array<{ beat: number; angleDeg: number; label: string }> = [
  { beat: 1, angleDeg: 0, label: "BEAT 1 (Downbeat)" },
  { beat: 2, angleDeg: 90, label: "BEAT 2" },
  { beat: 3, angleDeg: 180, label: "BEAT 3" },
  { beat: 4, angleDeg: 270, label: "BEAT 4" },
];

const ORBIT_RADII: Record<InstrumentRole, number> = {
  drums: 92,
  bass: 80,
  piano: 68,
  lead: 56,
};

export const BeatPhaseRing: React.FC<BeatPhaseRingProps> = ({
  nodes,
  modeState,
  phaseErrorMs,
  barNumber,
}) => {
  const cx = 140;
  const cy = 140;
  const isPhaseLocked = phaseErrorMs < 15 && modeState !== "partitioned";

  return (
    <section
      data-testid="beat-phase-ring"
      className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Disc className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Beat-Phase Alignment Radar
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="phase-error-readout"
            className="inline-flex items-center gap-1 rounded-md bg-slate-950 border border-slate-800 px-2 py-0.5 text-xs font-mono text-slate-200"
          >
            <Timer className="h-3 w-3 text-cyan-400" />
            Δ {phaseErrorMs.toFixed(1)} ms
          </span>

          {isPhaseLocked ? (
            <span
              data-testid="phase-lock-badge"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300"
            >
              <CheckCircle2 className="h-3 w-3" />
              &lt;15ms LOCK
            </span>
          ) : (
            <span
              data-testid="phase-lock-badge"
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300"
            >
              {modeState === "partitioned" ? "DRIFTING" : "CONVERGING"}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-around gap-3 bg-slate-950/90 rounded-lg border border-slate-800/70 p-3">
        <svg
          viewBox="0 0 280 280"
          className="w-[220px] h-[220px] select-none"
          role="img"
          aria-label="Beat Phase Alignment Ring"
        >
          {/* Concentric Track Rings */}
          {(["drums", "bass", "piano", "lead"] as const).map((role) => (
            <circle
              key={`track-${role}`}
              cx={cx}
              cy={cy}
              r={ORBIT_RADII[role]}
              fill="none"
              stroke="#1e293b"
              strokeWidth="1.5"
            />
          ))}

          {/* 4 Beat Spokes (0 deg = top dead center Beat 1) */}
          {BEAT_LABELS.map(({ beat, angleDeg }) => {
            const rad = ((angleDeg - 90) * Math.PI) / 180;
            const xOuter = cx + 106 * Math.cos(rad);
            const yOuter = cy + 106 * Math.sin(rad);
            const xLabel = cx + 122 * Math.cos(rad);
            const yLabel = cy + 122 * Math.sin(rad);

            return (
              <g key={beat}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={xOuter}
                  y2={yOuter}
                  stroke={beat === 1 ? "#10b981" : "#334155"}
                  strokeWidth={beat === 1 ? "2" : "1"}
                  strokeDasharray={beat === 1 ? undefined : "3 3"}
                />
                <text
                  x={xLabel}
                  y={yLabel + 4}
                  textAnchor="middle"
                  fill={beat === 1 ? "#34d399" : "#94a3b8"}
                  fontSize="10"
                  fontWeight={beat === 1 ? "bold" : "normal"}
                >
                  B{beat}
                </text>
              </g>
            );
          })}

          {/* Center Bar Counter */}
          <circle
            cx={cx}
            cy={cy}
            r="36"
            fill="#0f172a"
            stroke="#334155"
            strokeWidth="1.5"
          />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="9"
            fontWeight="600"
          >
            BAR
          </text>
          <text
            x={cx}
            y={cy + 13}
            textAnchor="middle"
            fill="#f8fafc"
            fontSize="15"
            fontWeight="bold"
            fontFamily="monospace"
          >
            #{barNumber + 1}
          </text>

          {/* 4 Instrument Orbital Dots */}
          {(["drums", "bass", "piano", "lead"] as const).map((role) => {
            const node = nodes[role];
            const radius = ORBIT_RADII[role];
            const phaseNormalized = ((node.beatPhase % 4) + 4) % 4; // 0..4
            const angleRad = (phaseNormalized / 4) * 2 * Math.PI - Math.PI / 2;
            const dotX = cx + radius * Math.cos(angleRad);
            const dotY = cy + radius * Math.sin(angleRad);

            return (
              <g key={`dot-${role}`}>
                <circle
                  cx={dotX}
                  cy={dotY}
                  r="7.5"
                  fill={ROLE_META[role].colorHex}
                  stroke="#020617"
                  strokeWidth="2"
                />
                <text
                  x={dotX}
                  y={dotY + 3}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="8"
                  fontWeight="bold"
                >
                  {role[0].toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Per-Instrument Phase & Tempo Readout */}
        <div className="w-full sm:w-auto space-y-2 text-xs">
          {(["drums", "bass", "piano", "lead"] as const).map((role) => {
            const node = nodes[role];
            const meta = ROLE_META[role];
            return (
              <div
                key={role}
                className="flex items-center justify-between gap-4 rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: meta.colorHex }}
                  />
                  <span className="font-semibold text-slate-200">
                    {meta.label}
                  </span>
                </div>
                <div className="font-mono text-slate-300">
                  Beat {(node.beatPhase + 1).toFixed(2)} ·{" "}
                  <span className="text-white font-semibold">
                    {node.bpm.toFixed(0)}
                  </span>{" "}
                  BPM
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
