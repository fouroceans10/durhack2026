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

  // Map each key+mode to the roles currently occupying it
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
      className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Circle-of-Fifths Harmonic Radar
          </h2>
        </div>

        {reconcilePlan ? (
          <span
            data-testid="pivot-chord-pill"
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-400/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200"
          >
            <Sparkles className="h-3 w-3 text-amber-300" />
            Pivot: {reconcilePlan.pivotChord} → {reconcilePlan.targetKeyRoot}{" "}
            {reconcilePlan.targetMode}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">
            Outer: Major · Inner: Minor / Dorian
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-around gap-3 bg-slate-950/90 rounded-lg border border-slate-800/70 p-3">
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
            stroke="#1e293b"
            strokeWidth="2"
          />
          <circle
            cx={cx}
            cy={cy}
            r={innerR}
            fill="none"
            stroke="#1e293b"
            strokeWidth="1.5"
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
                ? "#fbbf24"
                : "#334155";

            const minStroke =
              minRoles.length > 0
                ? ROLE_META[minRoles[0]].colorHex
                : isTargetMinor
                ? "#fbbf24"
                : "#334155";

            return (
              <g key={majorKey}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={xMaj}
                  y2={yMaj}
                  stroke="#1e293b"
                  strokeWidth="1"
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
                        ? "#1e1b4b"
                        : isTargetMajor
                        ? "#451a03"
                        : "#0f172a"
                    }
                    stroke={majStroke}
                    strokeWidth={majRoles.length > 0 || isTargetMajor ? 2.5 : 1.2}
                  />
                  <text
                    x={xMaj}
                    y={yMaj + 4}
                    textAnchor="middle"
                    fill={majRoles.length > 0 ? "#ffffff" : "#cbd5e1"}
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
                        ? "#2e1065"
                        : isTargetMinor
                        ? "#451a03"
                        : "#0f172a"
                    }
                    stroke={minStroke}
                    strokeWidth={minRoles.length > 0 || isTargetMinor ? 2.2 : 1}
                  />
                  <text
                    x={xMin}
                    y={yMin + 3}
                    textAnchor="middle"
                    fill={minRoles.length > 0 ? "#f3e8ff" : "#94a3b8"}
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
            fill="#0f172a"
            stroke={modeState === "bridging" ? "#fbbf24" : "#334155"}
            strokeWidth="1.8"
          />
          <text
            x={cx}
            y={cy - 5}
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="8.5"
            fontWeight="600"
          >
            {modeState === "bridging" ? "PIVOT" : "CHORD"}
          </text>
          <text
            x={cx}
            y={cy + 11}
            textAnchor="middle"
            fill="#fbbf24"
            fontSize="13"
            fontWeight="bold"
            fontFamily="monospace"
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
                  <span className="text-indigo-300 font-semibold">
                    {node.keyRoot} {node.mode}
                  </span>{" "}
                  · <span className="text-amber-300">{node.chordSymbol}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
