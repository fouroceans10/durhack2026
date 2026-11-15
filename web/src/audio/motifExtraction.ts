import { PitchDetector } from "pitchy";
import type { InstrumentRole, MotifRecord } from "@shared/types";
import { pitchClassToSemitone } from "../math/circleOfFifths";

export const MAX_CLIP_SECONDS = 30;
export const MAX_CLIP_BYTES = 15 * 1024 * 1024;
export const ANALYSIS_RATE = 16000;

export type ScaleMode = "major" | "minor" | "dorian";

const SCALE_INTERVALS: Record<ScaleMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const NOTE_VALUES = [1, 2, 3, 4, 6, 8, 12, 16] as const;

export interface HeardNote {
  midi: number;
  start: number;
  end: number;
  clarity: number;
}

export interface StartingPhrase {
  motif: number[];
  rhythm: number[];
  durations: number[];
  keyRoot: string;
  mode: ScaleMode;
}

export interface ExtractedMotif extends StartingPhrase {
  duration: number;
  notes: HeardNote[];
  detectedNotes: number;
  confidence: number;
  waveform: number[];
}

export function fitNoteValue(rawSteps: number, maxGap = 16): number {
  const clamped = Math.max(1, Math.min(maxGap, rawSteps));
  let best = 1;
  for (const val of NOTE_VALUES) {
    if (val <= clamped) best = val;
  }
  return best;
}

export function normalizeRhythm(input: { rhythm: number[]; durations?: number[] }): {
  rhythm: number[];
  durations: number[];
} {
  const seen = new Set<number>();
  const pairs: Array<{ step: number; dur: number }> = [];
  input.rhythm.forEach((rawStep, idx) => {
    const step = Math.max(0, Math.min(15, Math.round(rawStep)));
    if (!seen.has(step)) {
      seen.add(step);
      pairs.push({ step, dur: input.durations?.[idx] ?? 2 });
    }
  });
  pairs.sort((a, b) => a.step - b.step);
  if (pairs.length === 0) {
    return { rhythm: [0, 4, 8, 12], durations: [4, 4, 4, 4] };
  }
  const rhythm = pairs.map((p) => p.step);
  const durations = pairs.map((p, i) => {
    const nextStep = i + 1 < pairs.length ? pairs[i + 1].step : 16;
    const gap = Math.max(1, nextStep - p.step);
    return fitNoteValue(p.dur, gap);
  });
  return { rhythm, durations };
}

export function nearestDegree(
  midi: number,
  keyRoot = "C",
  mode: ScaleMode = "major",
): number {
  const tonic = pitchClassToSemitone(keyRoot);
  const pc = (((midi - tonic) % 12) + 12) % 12;
  const scale = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS.major;
  const distance = (n: number) => Math.min(Math.abs(n - pc), 12 - Math.abs(n - pc));
  return scale.reduce<number>((best, n, i) => (distance(n) < distance(scale[best]) ? i : best), 0);
}

const PITCH_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function degreeName(
  degree: number,
  keyRoot = "C",
  mode: ScaleMode = "major",
): string {
  const tonic = pitchClassToSemitone(keyRoot);
  const scale = SCALE_INTERVALS[mode] ?? SCALE_INTERVALS.major;
  const wrapped = ((degree % 7) + 7) % 7;
  const pc = (tonic + scale[wrapped]) % 12;
  return PITCH_NAMES[pc] ?? "C";
}

export function adaptMotif(
  result: ExtractedMotif,
  keyRoot = "C",
  mode: ScaleMode = "major",
): ExtractedMotif {
  return {
    ...result,
    keyRoot,
    mode,
    motif: result.notes.map((note) => nearestDegree(note.midi, keyRoot, mode)),
  };
}

export function extractMotif(
  samples: Float32Array,
  sampleRate: number,
  progress: (value: number) => void = () => {},
  keyRoot = "C",
  mode: ScaleMode = "major",
): ExtractedMotif {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error("Unsupported audio sample rate.");
  }
  const duration = samples.length / sampleRate;
  if (duration < 0.25 || duration > MAX_CLIP_SECONDS + 0.05) {
    throw new Error("Choose a snippet between 0.25 and 30 seconds.");
  }
  const size = 2 ** Math.ceil(Math.log2(sampleRate * 0.064));
  const hop = Math.round(sampleRate * 0.01);
  const detector = PitchDetector.forFloat32Array(size);
  const frame = new Float32Array(size);
  const energies: number[] = [];
  let peak = 0;

  for (let offset = 0; offset + size <= samples.length; offset += hop) {
    let sum = 0;
    for (let j = size / 2 - hop; j < size / 2 + hop; j++) {
      sum += samples[offset + j] ** 2;
    }
    const rms = Math.sqrt(sum / (hop * 2));
    energies.push(rms);
    peak = Math.max(peak, rms);
  }

  const gate = Math.max(0.002, peak * 0.08);
  const notes: HeardNote[] = [];
  let current: HeardNote | undefined;
  const flush = () => {
    if (current && current.end - current.start >= 0.08) {
      notes.push(current);
    }
    current = undefined;
  };

  let lastProgress = -1;
  energies.forEach((rms, index) => {
    const offset = index * hop;
    const time = (offset + size / 2) / sampleRate;
    let midi: number | undefined;
    let clarity = 0;
    if (rms >= gate) {
      frame.set(samples.subarray(offset, offset + size));
      const [frequency, certainty] = detector.findPitch(frame, sampleRate);
      if (certainty >= 0.88 && frequency >= 65 && frequency <= 1600) {
        midi = Math.round(69 + 12 * Math.log2(frequency / 440));
        clarity = certainty;
      }
    }
    if (midi !== undefined) {
      if (current?.midi === midi && time - current.end <= 0.05) {
        current.end = time + hop / sampleRate;
        current.clarity = Math.min(current.clarity, clarity);
      } else {
        flush();
        current = { midi, start: time, end: time + hop / sampleRate, clarity };
      }
    } else if (current && (rms < gate || time - current.end > 0.04)) {
      flush();
    }
    const percent = Math.floor((index / Math.max(1, energies.length)) * 100);
    if (percent >= lastProgress + 5) {
      lastProgress = percent;
      progress(percent);
    }
  });
  flush();

  if (
    !notes.length ||
    notes.reduce((sum, n) => sum + (n.end - n.start), 0) < 0.15
  ) {
    throw new Error(
      "No clear melody found. Try a solo instrument, humming or a whistle with less background sound.",
    );
  }

  const selected = notes.slice(0, 12);
  const first = selected[0].start;
  const span = Math.max(0.05, selected[selected.length - 1].end - first);
  const rhythm: number[] = [];
  const motif: number[] = [];
  const used: HeardNote[] = [];

  for (const note of selected) {
    const step = Math.min(15, Math.round(((note.start - first) / span) * 16));
    if (rhythm.includes(step)) continue;
    rhythm.push(step);
    motif.push(nearestDegree(note.midi, keyRoot, mode));
    used.push(note);
  }

  const waveform = Array.from({ length: 100 }, (_, i) => {
    const start = Math.floor((i * samples.length) / 100);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / 100));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ** 2;
    return Math.min(1, Math.sqrt(sum / (end - start)) / Math.max(peak, 0.001));
  });

  progress(100);
  const rawDurations = used.map((note) =>
    fitNoteValue(Math.round(((note.end - note.start) / span) * 16)),
  );
  const normalized = normalizeRhythm({ rhythm, durations: rawDurations });

  return {
    motif,
    rhythm: normalized.rhythm,
    durations: normalized.durations,
    keyRoot,
    mode,
    duration,
    notes: used,
    detectedNotes: notes.length,
    confidence: used.reduce((sum, n) => sum + n.clarity, 0) / used.length,
    waveform,
  };
}

export function generateStartingMotif(
  previous?: StartingPhrase,
  keyRoot = "C",
  mode: ScaleMode = "major",
  random: () => number = Math.random,
): StartingPhrase {
  const pick = (count: number) => Math.floor(random() * count);
  const length = 4 + pick(5);
  const motif = [[0, 2, 4, 5][pick(4)]];
  for (let i = 1; i < length; i++) {
    const next = motif[i - 1] + [-2, -1, -1, 1, 1, 2][pick(6)];
    motif.push(next < 0 ? -next : next > 6 ? 12 - next : next);
  }
  const second = 1 + pick(2);
  const available = Array.from({ length: 14 - second }, (_, i) => i + second + 1);
  for (let i = available.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [available[i], available[j]] = [available[j], available[i]];
  }
  const rhythm = [
    0,
    second,
    ...available.slice(0, length - 2).sort((a, b) => a - b),
  ];
  if (
    previous &&
    JSON.stringify({ motif, rhythm }) ===
      JSON.stringify({ motif: previous.motif, rhythm: previous.rhythm })
  ) {
    motif[motif.length - 1] = ((motif[motif.length - 1] ?? 0) + 1) % 7;
  }
  const normalized = normalizeRhythm({ rhythm });
  return {
    motif,
    rhythm: normalized.rhythm,
    durations: normalized.durations,
    keyRoot,
    mode,
  };
}

export function toMotifRecord(
  phrase: StartingPhrase,
  authorRole: InstrumentRole,
  partitionGroupId: string,
  bpm: number,
  label = "seed",
): MotifRecord {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24);
  return {
    id: `motif-${authorRole}-${slug || "voice"}-${phrase.motif.join("")}`,
    authorRole,
    createdDuringPartitionId: partitionGroupId,
    scaleDegrees: [...phrase.motif],
    rhythmSteps: [...phrase.rhythm],
    keyRoot: phrase.keyRoot,
    mode: phrase.mode,
    bpm: Math.round(bpm),
  };
}
