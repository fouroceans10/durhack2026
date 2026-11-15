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
      className="py-6 border-y border-[var(--ink)] flex flex-col gap-5"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left (5 cols): Musical Expression & Improvisation Controls */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-4 bg-[var(--paper-light)] border border-[var(--ink)] p-5">
          <div>
            <span className="eyebrow text-[var(--red)]">
              LIVE MUSICAL EXPRESSION
            </span>
            <h3 className="font-display text-2xl font-medium text-[var(--ink)] mt-1 mb-3">
              Drive, Tension &amp;{" "}
              <em className="italic font-medium text-[var(--red)]">
                Improvisation.
              </em>
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <label
                  htmlFor="energy-slider"
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--ink)]"
                >
                  <Flame className="h-3.5 w-3.5 text-[var(--red)]" />
                  Energy (Syncopation &amp; Drive)
                </label>
                <span className="font-mono text-xs text-[var(--ink)]">
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
                className="w-full accent-[var(--red)] cursor-pointer h-2 bg-[var(--rule)]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <label
                  htmlFor="tension-slider"
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--ink)]"
                >
                  <Zap className="h-3.5 w-3.5 text-[var(--brass)]" />
                  Harmonic Tension (7th/9th/Modal)
                </label>
                <span className="font-mono text-xs text-[var(--ink)]">
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
                className="w-full accent-[var(--red)] cursor-pointer h-2 bg-[var(--rule)]"
              />
            </div>
          </div>

          <button
            type="button"
            data-testid="improvise-motif-btn"
            onClick={onImproviseMotif}
            className="editorial-btn w-full flex items-center justify-center gap-2 mt-2"
          >
            <Wand2 className="h-4 w-4 text-[var(--red)]" />
            <span>Improvise New Motif</span>
          </button>
        </div>

        {/* Right (7 cols): Iconic Vermilion Experiment / Partition Card from main branch */}
        <div className="lg:col-span-7 bg-[var(--red)] text-[var(--paper-light)] p-6 flex flex-col justify-between relative">
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-[var(--paper-light)] opacity-90">
              AN INVITATION TO INTERRUPT · PARTITION MATRIX
            </span>
            <span className="text-2xl leading-none" aria-hidden="true">
              ↯
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center my-2">
            <div className="md:col-span-7">
              <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-tight leading-tight text-[var(--paper-light)] m-0 mb-2">
                What if the{" "}
                <em className="italic font-medium">network breaks?</em>
              </h2>
              <p className="text-[17px] leading-snug text-[#faf6ebdd] m-0">
                Split the orchestra into isolated sub-groups. Hear independent
                tempos, keys, and motifs emerge in isolation—then heal the
                network to trigger a 4-bar creative reconciliation bridge.
              </p>
            </div>

            <div className="md:col-span-5 grid grid-cols-3 items-center text-center py-2 border border-[#faf6eb44] bg-[#922c1d66]">
              <div>
                <b className="block font-display italic text-4xl leading-none">
                  02
                </b>
                <small className="font-mono text-[8px] tracking-widest uppercase">
                  BRANCH A
                </small>
              </div>
              <span className="font-display text-2xl">
                {modeState === "partitioned" ? "╳" : "↔"}
              </span>
              <div>
                <b className="block font-display italic text-4xl leading-none">
                  02
                </b>
                <small className="font-mono text-[8px] tracking-widest uppercase">
                  BRANCH B
                </small>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            <button
              type="button"
              data-testid="preset-split-2v2-btn"
              onClick={() => onApplyPreset("SPLIT_2V2")}
              className={`inline-flex items-center gap-1.5 border px-3.5 py-2.5 text-base transition cursor-pointer ${
                modeState === "partitioned"
                  ? "bg-[var(--paper-light)] text-[var(--red)] border-[var(--paper-light)] font-semibold"
                  : "bg-transparent hover:bg-[var(--paper-light)] hover:text-[var(--red)] border-[#faf6eb88] text-[var(--paper-light)]"
              }`}
            >
              <GitFork className="h-3.5 w-3.5" />
              Split 2v2 (Drums+Bass | Piano+Lead)
            </button>

            <button
              type="button"
              data-testid="preset-isolate-lead-btn"
              onClick={() => onApplyPreset("ISOLATE_LEAD")}
              className="inline-flex items-center gap-1.5 border border-[#faf6eb88] bg-transparent hover:bg-[var(--paper-light)] hover:text-[var(--red)] px-3.5 py-2.5 text-base text-[var(--paper-light)] transition cursor-pointer"
            >
              <UserMinus className="h-3.5 w-3.5" />
              Isolate Lead (1v3)
            </button>

            <button
              type="button"
              data-testid="preset-heal-all-btn"
              onClick={() => onApplyPreset("HEAL_ALL")}
              className={`inline-flex items-center gap-1.5 border px-3.5 py-2.5 text-base transition cursor-pointer ${
                modeState === "bridging"
                  ? "bg-[var(--paper-light)] text-[var(--red)] border-[var(--paper-light)] font-semibold"
                  : "bg-[#27251f] hover:bg-[var(--paper-light)] hover:text-[var(--red)] border-[#faf6eb88] text-[var(--paper-light)]"
              }`}
            >
              <GitMerge className="h-3.5 w-3.5" />
              Heal Network &amp; Reconcile (4-Bar Bridge)
            </button>

            <button
              type="button"
              data-testid="guided-demo-btn"
              onClick={onToggleGuidedDemo}
              className={`inline-flex items-center gap-1.5 border px-3.5 py-2.5 text-base transition cursor-pointer ml-auto ${
                guidedDemoActive
                  ? "bg-[var(--paper-light)] text-[var(--red)] border-[var(--paper-light)] font-semibold"
                  : "bg-transparent hover:bg-[var(--paper-light)] hover:text-[var(--red)] border-[#faf6ebaa] text-[var(--paper-light)]"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {guidedDemoActive
                ? "Stop Guided 90s Auto-Demo"
                : "Guided 90s Auto-Demo"}
            </button>
          </div>
        </div>
      </div>

      {/* 4-Stage Guided Choreography Itinerary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 border-t border-l border-[var(--rule)]">
        {GUIDED_DEMO_STAGES.map((stage) => {
          const isCurrent =
            guidedDemoActive && guidedDemoStage === stage.stageIndex;
          return (
            <div
              key={stage.stageIndex}
              className={`border-r border-b border-[var(--rule)] p-3.5 transition ${
                isCurrent
                  ? "bg-[var(--ink)] text-[var(--paper-light)]"
                  : "bg-[var(--paper-light)] text-[var(--ink)]"
              }`}
            >
              <div className="text-base font-semibold">{stage.label}</div>
              <div
                className={`font-mono text-[10px] mt-1 leading-relaxed ${
                  isCurrent ? "text-[var(--paper)]" : "text-[var(--muted)]"
                }`}
              >
                {stage.description}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
