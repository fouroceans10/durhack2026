import React from "react";
import {
  Flame,
  GitFork,
  GitMerge,
  Sparkles,
  UserMinus,
  Wand2,
  Zap,
} from "lucide-react";
import type {
  NetworkMode,
  PartitionPreset,
} from "../../../shared/types";

export interface DemoStageInfo {
  stageIndex: number; // 0..3
  label: string;
  description: string;
}

export const GUIDED_DEMO_STAGES: readonly DemoStageInfo[] = [
  {
    stageIndex: 0,
    label: "1. Unified Groove & Emergent Build",
    description:
      "All 4 peers locked in phase; raising Drums energy & Piano tension adapts Bass & Lead.",
  },
  {
    stageIndex: 1,
    label: "2. 2v2 Partition & Autonomous Divergence",
    description:
      "Drums+Bass drift faster clockwise (G Major); Piano+Lead drift slower to A Minor & invent motifs.",
  },
  {
    stageIndex: 2,
    label: "3. 4-Bar Creative Reconciliation Bridge",
    description:
      "Both sides compute identical ReconcilePlan, voice shared Pivot Chord, and converge onto Beat 1.",
  },
  {
    stageIndex: 3,
    label: "4. Re-Unified Enriched Arrangement",
    description:
      "Subgroups reunite at symmetric target BPM/Key with both isolation motifs woven together.",
  },
] as const;

export interface DemoControlBarProps {
  energy: number;
  tension: number;
  onChangeEnergy: (value: number) => void;
  onChangeTension: (value: number) => void;
  onImproviseMotif: () => void;
  onApplyPreset: (preset: PartitionPreset) => void;
  modeState: NetworkMode;
  guidedDemoActive: boolean;
  guidedDemoStage: number;
  onToggleGuidedDemo: () => void;
}

export const DemoControlBar: React.FC<DemoControlBarProps> = ({
  energy,
  tension,
  onChangeEnergy,
  onChangeTension,
  onImproviseMotif,
  onApplyPreset,
  modeState,
  guidedDemoActive,
  guidedDemoStage,
  onToggleGuidedDemo,
}) => {
  return (
    <section
      data-testid="demo-control-bar"
      className="rounded-xl border border-slate-800/90 bg-slate-900/75 p-4 flex flex-col gap-3.5"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        {/* Left (4 cols): Energy & Tension Sliders + Improvise Motif Button */}
        <div className="lg:col-span-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
          <div className="flex-1 space-y-2">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label
                  htmlFor="energy-slider"
                  className="inline-flex items-center gap-1 font-semibold text-rose-300"
                >
                  <Flame className="h-3.5 w-3.5 text-rose-400" />
                  Energy (Syncopation &amp; Drive)
                </label>
                <span className="font-mono text-slate-200">
                  {Math.round(energy * 100)}%
                </span>
              </div>
              <input
                id="energy-slider"
                data-testid="energy-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(energy * 100)}
                onChange={(e) => onChangeEnergy(Number(e.target.value) / 100)}
                className="w-full accent-rose-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label
                  htmlFor="tension-slider"
                  className="inline-flex items-center gap-1 font-semibold text-purple-300"
                >
                  <Zap className="h-3.5 w-3.5 text-purple-400" />
                  Harmonic Tension (7th/9th/Modal)
                </label>
                <span className="font-mono text-slate-200">
                  {Math.round(tension * 100)}%
                </span>
              </div>
              <input
                id="tension-slider"
                data-testid="tension-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(tension * 100)}
                onChange={(e) => onChangeTension(Number(e.target.value) / 100)}
                className="w-full accent-purple-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>
          </div>

          <button
            type="button"
            data-testid="improvise-motif-btn"
            onClick={onImproviseMotif}
            className="inline-flex flex-col items-center justify-center gap-1 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-400/40 px-3.5 py-2.5 text-xs font-semibold text-indigo-200 transition cursor-pointer shrink-0"
          >
            <Wand2 className="h-4 w-4 text-indigo-300" />
            <span>Improvise</span>
            <span>New Motif</span>
          </button>
        </div>

        {/* Center/Right (7 cols): One-Click Partition Presets & Guided 90s Auto-Demo */}
        <div className="lg:col-span-7 flex flex-wrap items-center justify-between gap-2.5 bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="preset-split-2v2-btn"
              onClick={() => onApplyPreset("SPLIT_2V2")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                modeState === "partitioned"
                  ? "bg-rose-500/25 border-rose-400 text-rose-100"
                  : "bg-slate-900 hover:bg-rose-950/60 border-rose-500/40 text-rose-200"
              }`}
            >
              <GitFork className="h-3.5 w-3.5 text-rose-400" />
              Split 2v2 (Drums+Bass | Piano+Lead)
            </button>

            <button
              type="button"
              data-testid="preset-isolate-lead-btn"
              onClick={() => onApplyPreset("ISOLATE_LEAD")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-amber-950/60 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-200 transition cursor-pointer"
            >
              <UserMinus className="h-3.5 w-3.5 text-amber-400" />
              Isolate Lead (1v3)
            </button>

            <button
              type="button"
              data-testid="preset-heal-all-btn"
              onClick={() => onApplyPreset("HEAL_ALL")}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                modeState === "bridging"
                  ? "bg-amber-500 text-slate-950 border-amber-300 shadow-lg shadow-amber-950/50"
                  : "bg-emerald-600/25 hover:bg-emerald-600/40 border-emerald-400/50 text-emerald-200"
              }`}
            >
              <GitMerge className="h-3.5 w-3.5" />
              Heal Network &amp; Reconcile (4-Bar Bridge)
            </button>
          </div>

          <button
            type="button"
            data-testid="guided-demo-btn"
            onClick={onToggleGuidedDemo}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
              guidedDemoActive
                ? "bg-amber-400 text-slate-950 border-amber-300 shadow-md"
                : "bg-gradient-to-r from-indigo-600/30 to-cyan-600/30 hover:from-indigo-600/50 hover:to-cyan-600/50 border-cyan-400/40 text-cyan-100"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {guidedDemoActive
              ? "Stop Guided 90s Auto-Demo"
              : "Guided 90s Auto-Demo"}
          </button>
        </div>
      </div>

      {/* 4-Stage Guided Choreography Timeline Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {GUIDED_DEMO_STAGES.map((stage) => {
          const isCurrent =
            guidedDemoActive && guidedDemoStage === stage.stageIndex;
          return (
            <div
              key={stage.stageIndex}
              className={`rounded-lg border px-3 py-2 transition ${
                isCurrent
                  ? "bg-indigo-950/70 border-cyan-400/70 text-white shadow"
                  : "bg-slate-950/50 border-slate-800/70 text-slate-400"
              }`}
            >
              <div className="text-xs font-semibold text-slate-200">
                {stage.label}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                {stage.description}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
