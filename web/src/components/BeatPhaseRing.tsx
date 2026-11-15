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
      className="border border-[var(--ink)] bg-[var(--paper-light)] p-5 flex flex-col justify-between"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 pb-2.5 border-b border-[var(--rule)]">
        <div>
          <span className="eyebrow text-[var(--red)]">
            KURAMOTO PHASE-LOCKED LOOP
          </span>
          <h2 className="font-display text-2xl font-medium text-[var(--ink)] mt-1 mb-0 flex items-center gap-2">
            <Disc className="h-4 w-4 text-[var(--woodwinds)]" />
            Beat-Phase Alignment Radar
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="phase-error-readout"
            className="inline-flex items-center gap-1 border border-[var(--rule)] bg-[var(--paper)] px-2.5 py-1 font-mono text-[10px] text-[var(--ink)]"
          >
            <Timer className="h-3 w-3 text-[var(--red)]" />
            Δ {phaseErrorMs.toFixed(1)} ms
          </span>

          {isPhaseLocked ? (
            <span
              data-testid="phase-lock-badge"
              className="inline-flex items-center gap-1 border border-[var(--woodwinds)] bg-[#3d665815] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--woodwinds)]"
            >
              <CheckCircle2 className="h-3 w-3" />
              &lt;15ms LOCK
            </span>
          ) : (
            <span
              data-testid="phase-lock-badge"
              className="inline-flex items-center gap-1 border border-[var(--red)] bg-[#bc382415] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--red)]"
            >
              {modeState === "partitioned" ? "DRIFTING" : "CONVERGING"}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-around gap-3 bg-[var(--paper)] border border-[var(--rule)] p-3">
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
              stroke="#c7c0af"
              strokeWidth="1"
              strokeDasharray="2 3"
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
                  stroke={beat === 1 ? "#bc3824" : "#706b5e"}
                  strokeWidth={beat === 1 ? "1.8" : "0.9"}
                  strokeDasharray={beat === 1 ? undefined : "3 3"}
                />
                <text
                  x={xLabel}
                  y={yLabel + 4}
                  textAnchor="middle"
                  fill={beat === 1 ? "#bc3824" : "#706b5e"}
                  fontSize="10"
                  fontFamily="IBM Plex Mono, monospace"
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
            fill="#faf6eb"
            stroke="#27251f"
            strokeWidth="1.2"
          />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="#706b5e"
            fontSize="8"
            fontFamily="IBM Plex Mono, monospace"
          >
            BAR
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="#27251f"
            fontSize="17"
            fontStyle="italic"
            fontFamily="Bodoni Moda, serif"
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
                  r="8"
                  fill={ROLE_META[role].colorHex}
                  stroke="#faf6eb"
                  strokeWidth="1.5"
                />
                <text
                  x={dotX}
                  y={dotY + 3}
                  textAnchor="middle"
                  fill="#faf6eb"
                  fontSize="8"
                  fontFamily="IBM Plex Mono, monospace"
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
                className="flex items-center justify-between gap-4 bg-[var(--paper-light)] border border-[var(--rule)] px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: meta.colorHex }}
                  />
                  <span className="font-medium text-base text-[var(--ink)]">
                    {meta.label}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-[var(--muted)]">
                  Beat {(node.beatPhase + 1).toFixed(2)} ·{" "}
                  <span className="text-[var(--ink)] font-semibold">
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
