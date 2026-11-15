import type { MotifRecord, MusicalMode } from "./types";
import {
  type CanonicalPitchClass,
  normalizePitchClass,
  pitchClassToSemitone,
  semitoneToPitchClass,
} from "./circleOfFifths";

export const MODE_INTERVALS: Record<MusicalMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
} as const;

export interface ParsedChord {
  symbol: string;
  root: CanonicalPitchClass;
  quality: string;
  intervals: number[];
  pitchClasses: CanonicalPitchClass[];
  midiNotes: number[];
  noteNames: string[];
}

export interface RealizedMotifEvent {
  step: number;
  scaleDegree: number;
  midi: number;
  noteName: string;
  frequency: number;
}

/**
 * Returns the 7 canonical pitch classes of a diatonic scale.
 */
export function getScaleNotes(
  keyRoot: string,
  mode: MusicalMode
): CanonicalPitchClass[] {
  const rootSemitone = pitchClassToSemitone(keyRoot);
  return MODE_INTERVALS[mode].map((interval) =>
    semitoneToPitchClass(rootSemitone + interval)
  );
}

/**
 * Converts a MIDI note number (e.g. 60 = C4, 69 = A4) to scientific pitch notation.
 */
export function midiToNoteName(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  const pitchClass = semitoneToPitchClass(clamped);
  const octave = Math.floor(clamped / 12) - 1;
  return `${pitchClass}${octave}`;
}

/**
 * Converts a MIDI note number to frequency in Hz (A4 = 69 = 440 Hz).
 */
export function midiToFrequency(midi: number): number {
  return Number((440 * Math.pow(2, (midi - 69) / 12)).toFixed(4));
}

/**
 * Maps an arbitrary integer scale degree (0-based, supporting negative degrees
 * and multi-octave degrees >= 7) to a MIDI note number.
 */
export function scaleDegreeToMidi(
  degree: number,
  keyRoot: string,
  mode: MusicalMode,
  baseOctave = 4
): number {
  const intervals = MODE_INTERVALS[mode];
  const scaleLen = intervals.length; // 7
  const intDegree = Math.trunc(degree);

  const octaveShift = Math.floor(intDegree / scaleLen);
  const degreeInScale = ((intDegree % scaleLen) + scaleLen) % scaleLen;

  const rootSemitone = pitchClassToSemitone(keyRoot);
  const baseRootMidi = (baseOctave + 1) * 12 + rootSemitone;
  const targetMidi =
    baseRootMidi + octaveShift * 12 + intervals[degreeInScale];

  return Math.max(0, Math.min(127, targetMidi));
}

/**
 * Maps an arbitrary integer scale degree to a scientific pitch name (e.g. "C4", "G4").
 */
export function scaleDegreeToNoteName(
  degree: number,
  keyRoot: string,
  mode: MusicalMode,
  baseOctave = 4
): string {
  return midiToNoteName(scaleDegreeToMidi(degree, keyRoot, mode, baseOctave));
}

const CHORD_QUALITY_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  M: [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  "7sus4": [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

/**
 * Parses a chord symbol (e.g., "Cmaj7", "Am", "G7sus4", "F#m7b5") into
 * constituent intervals, pitch classes, MIDI notes, and scientific note names.
 */
export function parseChordSymbol(
  chordSymbol: string,
  baseOctave = 3
): ParsedChord {
  const trimmed = chordSymbol.trim();
  const match = trimmed.match(/^([A-G][#b]?)(.*)$/i);
  if (!match) {
    throw new Error(`Invalid chord symbol: "${chordSymbol}"`);
  }

  const root = normalizePitchClass(match[1]);
  // Strip optional slash bass note if present for quality lookup
  const rawQuality = match[2].split("/")[0].trim();
  const intervals =
    CHORD_QUALITY_INTERVALS[rawQuality] ?? CHORD_QUALITY_INTERVALS[""];

  const rootSemitone = pitchClassToSemitone(root);
  const baseMidi = (baseOctave + 1) * 12 + rootSemitone;

  const pitchClasses = intervals.map((i) =>
    semitoneToPitchClass(rootSemitone + i)
  );
  const midiNotes = intervals.map((i) => baseMidi + i);
  const noteNames = midiNotes.map((m) => midiToNoteName(m));

  return {
    symbol: `${root}${rawQuality}`,
    root,
    quality: rawQuality,
    intervals: [...intervals],
    pitchClasses,
    midiNotes,
    noteNames,
  };
}

/**
 * Builds the diatonic chord on `degreeIndex` (0..6) of `(keyRoot, mode)`.
 */
export function getDiatonicChord(
  keyRoot: string,
  mode: MusicalMode,
  degreeIndex: number,
  seventh = false,
  baseOctave = 3
): ParsedChord {
  const scale = MODE_INTERVALS[mode];
  const normDeg = ((Math.trunc(degreeIndex) % 7) + 7) % 7;
  const rootSemitone = pitchClassToSemitone(keyRoot);

  const degSemitone = scale[normDeg];
  const thirdSemitone =
    scale[(normDeg + 2) % 7] + (normDeg + 2 >= 7 ? 12 : 0) - degSemitone;
  const fifthSemitone =
    scale[(normDeg + 4) % 7] + (normDeg + 4 >= 7 ? 12 : 0) - degSemitone;
  const seventhSemitone =
    scale[(normDeg + 6) % 7] + (normDeg + 6 >= 7 ? 12 : 0) - degSemitone;

  const chordRoot = semitoneToPitchClass(rootSemitone + degSemitone);

  let quality = "";
  if (thirdSemitone === 3 && fifthSemitone === 6) {
    quality = seventh ? "m7b5" : "dim";
  } else if (thirdSemitone === 3) {
    quality = seventh ? "m7" : "m";
  } else if (thirdSemitone === 4 && seventh) {
    quality = seventhSemitone === 11 ? "maj7" : "7";
  }

  return parseChordSymbol(`${chordRoot}${quality}`, baseOctave);
}

/**
 * Returns a deterministic 4-bar chord progression for the given key, mode, and tension [0..1].
 */
export function getDiatonicProgression(
  keyRoot: string,
  mode: MusicalMode,
  tension = 0
): string[] {
  const clampedTension = Math.max(0, Math.min(1, tension));
  const useSevenths = clampedTension >= 0.55;

  // Degree progressions by mode and tension tier
  let degrees: [number, number, number, number];
  if (mode === "major") {
    degrees =
      clampedTension < 0.35
        ? [0, 4, 5, 3] // I - V - vi - IV
        : clampedTension < 0.7
        ? [0, 5, 1, 4] // I - vi - ii - V
        : [1, 4, 2, 5]; // ii - V - iii - vi
  } else if (mode === "minor") {
    degrees =
      clampedTension < 0.35
        ? [0, 5, 2, 6] // i - VI - III - VII
        : clampedTension < 0.7
        ? [0, 3, 6, 4] // i - iv - VII - v
        : [0, 1, 4, 5]; // i - ii° - v - VI
  } else {
    // dorian
    degrees =
      clampedTension < 0.35
        ? [0, 3, 6, 3] // i - IV - VII - IV
        : clampedTension < 0.7
        ? [0, 1, 3, 6] // i - ii - IV - VII
        : [0, 3, 4, 6]; // i - IV - v - VII
  }

  return degrees.map(
    (deg) => getDiatonicChord(keyRoot, mode, deg, useSevenths).symbol
  );
}

/**
 * Realizes a MotifRecord into concrete MIDI/frequency note events in a target key and mode.
 */
export function realizeMotifNotes(
  motif: MotifRecord,
  targetKeyRoot: string = motif.keyRoot,
  targetMode: MusicalMode = motif.mode,
  baseOctave = 4
): RealizedMotifEvent[] {
  const count = Math.min(motif.scaleDegrees.length, motif.rhythmSteps.length);
  const events: RealizedMotifEvent[] = [];

  for (let i = 0; i < count; i++) {
    const scaleDegree = motif.scaleDegrees[i];
    const step = motif.rhythmSteps[i];
    const midi = scaleDegreeToMidi(
      scaleDegree,
      targetKeyRoot,
      targetMode,
      baseOctave
    );
    events.push({
      step,
      scaleDegree,
      midi,
      noteName: midiToNoteName(midi),
      frequency: midiToFrequency(midi),
    });
  }

  return events;
}

/**
 * Deterministically adapts a MotifRecord to a new keyRoot, mode, and optional bpm
 * while preserving its scale-degree contour and 16th-note rhythm steps.
 */
export function transposeMotif(
  motif: MotifRecord,
  targetKeyRoot: string,
  targetMode: MusicalMode,
  targetBpm: number = motif.bpm
): MotifRecord {
  return {
    ...motif,
    scaleDegrees: [...motif.scaleDegrees],
    rhythmSteps: [...motif.rhythmSteps],
    keyRoot: normalizePitchClass(targetKeyRoot),
    mode: targetMode,
    bpm: targetBpm,
  };
}
