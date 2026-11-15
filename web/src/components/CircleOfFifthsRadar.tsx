import React from "react";
import { Compass, Sparkles } from "lucide-react";
import type {
  InstrumentRole,
  MusicalMode,
  NetworkMode,
  ReconcilePlan,
} from "../../../shared/types";
import {
  CIRCLE_OF_FIFTHS,
  circleOfFifthsIndex,
  normalizePitchClass,
} from "../math/circleOfFifths";
import {
  ROLE_META,
  type InstrumentNodeTelemetry,
} from "./observatoryTypes";

export interface CircleOfFifthsRadarProps {
  nodes: Record<InstrumentRole, InstrumentNodeTelemetry>;
  modeState: NetworkMode;
  reconcilePlan: ReconcilePlan | null;
  onSelectKeyAndMode: (keyRoot: string, mode: MusicalMode) => void;
}

const RELATIVE_MINORS: readonly string[] = [
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
] as const;

export const CircleOfFifthsRadar: React.FC<CircleOfFifthsRadarProps> = ({
  nodes,
  modeState,
  reconcilePlan,
  onSelectKeyAndMode,
}) => {
  const cx = 145;
  const cy = 145;
  const outerR = 104;
  const innerR = 66;

  const activeOuterRoles = new Map<number, InstrumentRole[]>();
  const activeInnerRoles = new Map<number, InstrumentRole[]>();

  for (const role of ["drums", "bass", "piano", "lead"] as const) {
    const node = nodes[role];
    const normKey = normalizePitchClass(node.keyRoot);
    if (node.mode === "major") {
      const idx = circleOfFifthsIndex(normKey);
      const list = activeOuterRoles.get(idx) ?? [];
      list.push(role);
      activeOuterRoles.set(idx, list);
    } else {
      const idx = RELATIVE_MINORS.indexOf(normKey);
      const safeIdx = idx >= 0 ? idx : circleOfFifthsIndex(normKey);
      const list = activeInnerRoles.get(safeIdx) ?? [];
      list.push(role);
      activeInnerRoles.set(safeIdx, list);
    }
  }

  const targetKeyIdx = reconcilePlan
    ? circleOfFifthsIndex(reconcilePlan.targetKeyRoot)
    : -1;

  return (
    <section
      data-testid="circle-of-fifths-radar"
      className="border border-[var(--ink)] bg-[var(--paper-light)] p-5 flex flex-col justify-between"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 pb-2.5 border-b border-[var(--rule)]">
        <div>
          <span className="eyebrow text-[var(--red)]">
            HARMONIC MODULATION &amp; PIVOT CONSENSUS
          </span>
          <h2 className="font-display text-2xl font-medium text-[var(--ink)] mt-1 mb-0 flex items-center gap-2">
            <Compass className="h-4 w-4 text-[var(--red)]" />
            Circle-of-Fifths Harmonic Radar
          </h2>
        </div>

        {reconcilePlan ? (
          <span
            data-testid="pivot-chord-pill"
            className="inline-flex items-center gap-1 border border-[var(--brass)] bg-[#80602218] px-2.5 py-1 font-mono text-[10px] font-semibold text-[var(--brass)]"
          >
            <Sparkles className="h-3 w-3 text-[var(--brass)]" />
            Pivot: {reconcilePlan.pivotChord} → {reconcilePlan.targetKeyRoot}{" "}
            {reconcilePlan.targetMode}
          </span>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--muted)]">
            Outer: Major · Inner: Minor / Dorian
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-around gap-3 bg-[var(--paper)] border border-[var(--rule)] p-3">
        <svg
          viewBox="0 0 290 290"
          className="w-[225px] h-[225px] select-none"
          role="img"
          aria-label="Circle of Fifths Harmonic Radar"
        >
          {/* Outer Major & Inner Minor Rings */}
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="none"
            stroke="#27251f"
            strokeWidth="0.9"
          />
          <circle
            cx={cx}
            cy={cy}
            r={innerR}
            fill="none"
            stroke="#c7c0af"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* 12 Spokes of the Circle of Fifths */}
          {CIRCLE_OF_FIFTHS.map((majorKey, idx) => {
            const angleRad = (idx / 12) * 2 * Math.PI - Math.PI / 2;
            const xMaj = cx + outerR * Math.cos(angleRad);
            const yMaj = cy + outerR * Math.sin(angleRad);
            const xMin = cx + innerR * Math.cos(angleRad);
            const yMin = cy + innerR * Math.sin(angleRad);

            const minorKey = RELATIVE_MINORS[idx];
            const majRoles = activeOuterRoles.get(idx) ?? [];
            const minRoles = activeInnerRoles.get(idx) ?? [];
            const isTargetMajor =
              modeState === "bridging" &&
              targetKeyIdx === idx &&
              reconcilePlan?.targetMode === "major";
            const isTargetMinor =
              modeState === "bridging" &&
              reconcilePlan &&
              reconcilePlan.targetMode !== "major" &&
              normalizePitchClass(reconcilePlan.targetKeyRoot) === minorKey;

            const majStroke =
              majRoles.length > 0
                ? ROLE_META[majRoles[0]].colorHex
                : isTargetMajor
                ? "#806022"
                : "#c7c0af";

            const minStroke =
              minRoles.length > 0
                ? ROLE_META[minRoles[0]].colorHex
                : isTargetMinor
                ? "#806022"
                : "#c7c0af";

            return (
              <g key={majorKey}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={xMaj}
                  y2={yMaj}
                  stroke="#c7c0af"
                  strokeWidth="0.7"
                />

                {/* Outer Spoke Node: Major Key */}
                <g
                  className="cursor-pointer"
                  onClick={() => onSelectKeyAndMode(majorKey, "major")}
                >
                  <circle
                    cx={xMaj}
                    cy={yMaj}
                    r={majRoles.length > 0 || isTargetMajor ? 15 : 12}
                    fill={
                      majRoles.length > 0
                        ? "#bc3824"
                        : isTargetMajor
                        ? "#806022"
                        : "#faf6eb"
                    }
                    stroke={majStroke}
                    strokeWidth={
                      majRoles.length > 0 || isTargetMajor ? 2.2 : 1.1
                    }
                  />
                  <text
                    x={xMaj}
                    y={yMaj + 4}
                    textAnchor="middle"
                    fill={
                      majRoles.length > 0 || isTargetMajor
                        ? "#faf6eb"
                        : "#27251f"
                    }
                    fontSize="10"
                    fontWeight="bold"
                  >
                    {majorKey}
                  </text>
                </g>

                {/* Inner Spoke Node: Relative Minor / Dorian Key */}
                <g
                  className="cursor-pointer"
                  onClick={() => onSelectKeyAndMode(minorKey, "minor")}
                >
                  <circle
                    cx={xMin}
                    cy={yMin}
                    r={minRoles.length > 0 || isTargetMinor ? 13 : 10}
                    fill={
                      minRoles.length > 0
                        ? "#3c5c77"
                        : isTargetMinor
                        ? "#806022"
                        : "#faf6eb"
                    }
                    stroke={minStroke}
                    strokeWidth={
                      minRoles.length > 0 || isTargetMinor ? 2.0 : 1.0
                    }
                  />
                  <text
                    x={xMin}
                    y={yMin + 3}
                    textAnchor="middle"
                    fill={
                      minRoles.length > 0 || isTargetMinor
                        ? "#faf6eb"
                        : "#706b5e"
                    }
                    fontSize="8.5"
                    fontWeight="600"
                  >
                    {minorKey}m
                  </text>
                </g>
              </g>
            );
          })}

          {/* Center Hub: Pivot or Current Harmonic Summary */}
          <circle
            cx={cx}
            cy={cy}
            r="34"
            fill="#faf6eb"
            stroke={modeState === "bridging" ? "#806022" : "#27251f"}
            strokeWidth="1.5"
          />
          <text
            x={cx}
            y={cy - 5}
            textAnchor="middle"
            fill="#706b5e"
            fontSize="8"
            fontFamily="IBM Plex Mono, monospace"
          >
            {modeState === "bridging" ? "PIVOT" : "CHORD"}
          </text>
          <text
            x={cx}
            y={cy + 13}
            textAnchor="middle"
            fill="#bc3824"
            fontSize="15"
            fontStyle="italic"
            fontFamily="Bodoni Moda, serif"
          >
            {modeState === "bridging" && reconcilePlan
              ? reconcilePlan.pivotChord
              : nodes.piano.chordSymbol}
          </text>
        </svg>

        {/* Harmonic Subgroup Summary */}
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
                  <span className="text-[var(--ink)] font-semibold">
                    {node.keyRoot} {node.mode}
                  </span>{" "}
                  · <span className="text-[var(--red)]">{node.chordSymbol}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
