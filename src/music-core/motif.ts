import type {
  InstrumentRole,
  MotifRecord,
  MusicalMode,
  NetworkMode,
} from "./types";
import { normalizePitchClass } from "./circleOfFifths";

export interface AIStrategistOptions {
  enabled?: boolean;
  endpointUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface AIStrategyContext {
  role: InstrumentRole;
  partitionGroupId: string;
  modeState: NetworkMode;
  bpm: number;
  keyRoot: string;
  mode: MusicalMode;
  energy: number;
  tension: number;
  barNumber: number;
  hasDrumsInGroup: boolean;
}

export interface AIStrategySuggestion {
  source: "ai" | "deterministic-fallback";
  motif: MotifRecord;
  energyDelta: number;
  tensionDelta: number;
  rationale: string;
}

const RHYTHMIC_DEGREE_PATTERNS: readonly (readonly number[])[] = [
  [0, 4, 5, 7, 4, 2, 0, 4],
  [0, 2, 4, 5, 7, 4, 2, 0],
  [0, 7, 4, 5, 2, 4, 0, -1],
] as const;

const RHYTHMIC_STEP_PATTERNS: readonly (readonly number[])[] = [
  [0, 3, 6, 8, 10, 12, 14, 15],
  [0, 2, 3, 6, 8, 11, 12, 14],
  [0, 3, 4, 7, 8, 10, 13, 15],
] as const;

const LYRICAL_DEGREE_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 7, 5, 4, 2, 0],
  [4, 6, 7, 9, 7, 5, 4, 2],
  [2, 4, 5, 7, 6, 4, 2, 0],
] as const;

const LYRICAL_STEP_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 5, 7, 8, 11, 13, 14],
  [1, 3, 4, 6, 9, 11, 12, 15],
] as const;

/**
 * Pure deterministic motif generator used as the baseline and instant fallback
 * whenever the optional AI strategist is disabled or unreachable.
 */
export function generateDeterministicMotif(
  ctx: AIStrategyContext,
  sequenceIndex = 0
): MotifRecord {
  const safeIdx = Math.abs(Math.trunc(ctx.barNumber + sequenceIndex));
  const canonicalKey = normalizePitchClass(ctx.keyRoot);

  if (ctx.hasDrumsInGroup) {
    const degrees = [
      ...RHYTHMIC_DEGREE_PATTERNS[safeIdx % RHYTHMIC_DEGREE_PATTERNS.length],
    ];
    const steps = [
      ...RHYTHMIC_STEP_PATTERNS[safeIdx % RHYTHMIC_STEP_PATTERNS.length],
    ];
    return {
      id: `motif-${ctx.role}-rhythm-${ctx.partitionGroupId}-b${ctx.barNumber}-s${sequenceIndex}`,
      authorRole: ctx.role,
      createdDuringPartitionId: ctx.partitionGroupId,
      scaleDegrees: degrees,
      rhythmSteps: steps,
      keyRoot: canonicalKey,
      mode: ctx.mode,
      bpm: ctx.bpm,
    };
  }

  const degrees = [
    ...LYRICAL_DEGREE_PATTERNS[safeIdx % LYRICAL_DEGREE_PATTERNS.length],
  ];
  const steps = [
    ...LYRICAL_STEP_PATTERNS[safeIdx % LYRICAL_STEP_PATTERNS.length],
  ];
  return {
    id: `motif-${ctx.role}-lyrical-${ctx.partitionGroupId}-b${ctx.barNumber}-s${sequenceIndex}`,
    authorRole: ctx.role,
    createdDuringPartitionId: ctx.partitionGroupId,
    scaleDegrees: degrees,
    rhythmSteps: steps,
    keyRoot: canonicalKey,
    mode: ctx.mode,
    bpm: ctx.bpm,
  };
}

