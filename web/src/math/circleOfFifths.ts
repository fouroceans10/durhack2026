import type { MusicalMode } from "../../../shared/types";

/**
 * Canonical 12 chromatic pitch classes in ascending semitone order (0..11).
 */
export const CHROMATIC_PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export type CanonicalPitchClass = (typeof CHROMATIC_PITCH_CLASSES)[number];

/**
 * Clockwise 12-position Circle of Fifths ordering (+7 semitones per step).
 */
export const CIRCLE_OF_FIFTHS: readonly CanonicalPitchClass[] = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "Ab",
  "Eb",
  "Bb",
  "F",
] as const;

const ENHARMONIC_MAP: Record<string, CanonicalPitchClass> = {
  C: "C",
  "B#": "C",
  "C#": "C#",
  DB: "C#",
  D: "D",
  "D#": "Eb",
  EB: "Eb",
  E: "E",
  FB: "E",
  F: "F",
  "E#": "F",
  "F#": "F#",
  GB: "F#",
  G: "G",
  "G#": "Ab",
  AB: "Ab",
  A: "A",
  "A#": "Bb",
  BB: "Bb",
  B: "B",
  CB: "B",
};

const MODE_INTERVALS_SEMITONES: Record<MusicalMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

/**
 * Triad qualities across scale degrees 0..6 for each mode.
 * "" = major, "m" = minor, "dim" = diminished.
 */
const MODE_TRIAD_QUALITIES: Record<MusicalMode, readonly string[]> = {
  major: ["", "m", "m", "", "", "m", "dim"],
  minor: ["m", "dim", "", "m", "m", "", ""],
  dorian: ["m", "m", "", "", "m", "dim", ""],
};

const MODE_RANK: Record<MusicalMode, number> = {
  major: 0,
  dorian: 1,
  minor: 2,
};

/**
 * Normalizes any note/key string (e.g. "db", "D#", "F#4", "Bb") to its
 * canonical pitch class in CHROMATIC_PITCH_CLASSES.
 */
export function normalizePitchClass(input: string): CanonicalPitchClass {
  const cleaned = input.trim().replace(/[0-9-]/g, "");
  if (!cleaned) {
    throw new Error(`Invalid pitch class: "${input}"`);
  }
  const head = cleaned[0].toUpperCase();
  const accidental = cleaned.slice(1).toUpperCase();
  const lookup = `${head}${accidental}`;
  const resolved = ENHARMONIC_MAP[lookup];
  if (!resolved) {
    throw new Error(`Unrecognized pitch class: "${input}"`);
  }
  return resolved;
}

/**
 * Converts a pitch class name to its semitone index 0..11 (C = 0).
 */
export function pitchClassToSemitone(note: string): number {
  const canonical = normalizePitchClass(note);
  return CHROMATIC_PITCH_CLASSES.indexOf(canonical);
}

/**
 * Converts any integer semitone offset to its canonical pitch class (mod 12).
 */
export function semitoneToPitchClass(semitone: number): CanonicalPitchClass {
  const wrapped = ((Math.round(semitone) % 12) + 12) % 12;
  return CHROMATIC_PITCH_CLASSES[wrapped];
}

/**
 * Returns the index (0..11) of a key root on the Circle of Fifths.
 */
export function circleOfFifthsIndex(keyRoot: string): number {
  const canonical = normalizePitchClass(keyRoot);
  return CIRCLE_OF_FIFTHS.indexOf(canonical);
}

/**
 * Returns the key signature's position (0..11) on the Circle of Fifths,
 * accounting for relative mode offsets:
 * - major: +0 fifths from tonic
 * - dorian: -2 fifths (+10 mod 12) from tonic (e.g., D dorian -> C major at 0)
 * - minor: -3 fifths (+9 mod 12) from tonic (e.g., A minor -> C major at 0)
 */
export function signatureCircleIndex(
  keyRoot: string,
  mode: MusicalMode = "major"
): number {
  const rootIdx = circleOfFifthsIndex(keyRoot);
  const modeOffset = mode === "major" ? 0 : mode === "dorian" ? 10 : 9;
  return (rootIdx + modeOffset) % 12;
}

/**
 * Shortest undirected step distance [0..6] between two key roots on the Circle of Fifths.
 * Strictly symmetric: circleOfFifthsDistance(a, b) === circleOfFifthsDistance(b, a).
 */
export function circleOfFifthsDistance(keyA: string, keyB: string): number {
  const idxA = circleOfFifthsIndex(keyA);
  const idxB = circleOfFifthsIndex(keyB);
  const diff = Math.abs(idxA - idxB);
  return Math.min(diff, 12 - diff);
}

/**
 * Shortest signed steps on the Circle of Fifths from `fromKey` to `toKey` in [-5..+6].
 * Positive = clockwise (sharper/dominant direction), Negative = counter-clockwise (flatter/subdominant).
 * At distance 6 (tritone), tie-breaks deterministically to +6.
 */
export function signedCircleSteps(fromKey: string, toKey: string): number {
  const idxFrom = circleOfFifthsIndex(fromKey);
  const idxTo = circleOfFifthsIndex(toKey);
  const clockwise = (idxTo - idxFrom + 12) % 12;
  if (clockwise <= 6) {
    return clockwise;
  }
  return clockwise - 12;
}

/**
 * Computes a deterministic, strictly commutative midpoint key and mode on the
 * Circle of Fifths between two keys/modes:
 *   computeMidpointKey(a, mA, b, mB) === computeMidpointKey(b, mB, a, mA)
 */
export function computeMidpointKey(
  keyA: string,
  modeA: MusicalMode,
  keyB: string,
  modeB: MusicalMode
): { targetKeyRoot: CanonicalPitchClass; targetMode: MusicalMode } {
  const normA = normalizePitchClass(keyA);
  const normB = normalizePitchClass(keyB);
  const idxA = circleOfFifthsIndex(normA);
  const idxB = circleOfFifthsIndex(normB);

  // Order the pair canonically by (circleIndex, modeRank) so (A,B) and (B,A) are identical.
  const aFirst =
    idxA < idxB || (idxA === idxB && MODE_RANK[modeA] <= MODE_RANK[modeB]);
  const idxLow = aFirst ? idxA : idxB;
  const idxHigh = aFirst ? idxB : idxA;

  const directSpan = idxHigh - idxLow; // 0..11
  const wrapSpan = 12 - directSpan;

  let midCircleIdx: number;
  if (directSpan < wrapSpan) {
    midCircleIdx = (idxLow + Math.floor(directSpan / 2)) % 12;
  } else if (wrapSpan < directSpan) {
    midCircleIdx = (idxHigh + Math.floor(wrapSpan / 2)) % 12;
  } else {
    // Exact tritone opposite (directSpan === 6): deterministic canonical midpoint
    midCircleIdx = (idxLow + 3) % 12;
  }

  let targetMode: MusicalMode;
  if (modeA === modeB) {
    targetMode = modeA;
  } else if (
    (modeA === "major" && modeB === "minor") ||
    (modeA === "minor" && modeB === "major")
  ) {
    // Dorian is the exact modal midpoint between Major and Natural Minor
    targetMode = "dorian";
  } else {
    // One is dorian and the other is major/minor -> converge on dorian as shared modal bridge
    targetMode = "dorian";
  }

  return {
    targetKeyRoot: CIRCLE_OF_FIFTHS[midCircleIdx],
    targetMode,
  };
}

/**
 * Returns the 7 diatonic triad symbols (e.g. ["C", "Dm", "Em", "F", "G", "Am", "Bdim"])
 * for a given keyRoot and mode.
 */
export function getDiatonicTriadSymbols(
  keyRoot: string,
  mode: MusicalMode
): string[] {
  const rootSemitone = pitchClassToSemitone(keyRoot);
  const intervals = MODE_INTERVALS_SEMITONES[mode];
  const qualities = MODE_TRIAD_QUALITIES[mode];

  return intervals.map((offset, degreeIdx) => {
    const chordRoot = semitoneToPitchClass(rootSemitone + offset);
    return `${chordRoot}${qualities[degreeIdx]}`;
  });
}

function extractChordRoot(chordSymbol: string): CanonicalPitchClass {
  const match = chordSymbol.match(/^[A-G][#b]?/i);
  if (!match) {
    return "C";
  }
  return normalizePitchClass(match[0]);
}

/**
 * Computes a shared Circle-of-Fifths pivot chord bridging (keyA, modeA) and (keyB, modeB).
 *
 * Strictly commutative (order-independent):
 *   computePivotChord(keyA, modeA, keyB, modeB) === computePivotChord(keyB, modeB, keyA, modeA)
 *
 * Algorithm:
 * 1. Computes the deterministic midpoint `{ targetKeyRoot, targetMode }`.
 * 2. Collects the union of non-diminished diatonic triads shared between (keyA, modeA)
 *    and (keyB, modeB).
 * 3. If shared diatonic triads exist, selects the one closest on the Circle of Fifths
 *    to the dominant (V) or subdominant/relative pivot of `targetKeyRoot`, breaking ties
 *    canonically by Circle-of-Fifths index and quality.
 * 4. If the two keys are so distant on the Circle of Fifths that they share zero
 *    diatonic triads, constructs the suspended dominant pivot (`${dominantOfTarget}7sus4`)
 *    rooted a perfect fifth above `targetKeyRoot`.
 */
export function computePivotChord(
  keyA: string,
  modeA: MusicalMode,
  keyB: string,
  modeB: MusicalMode
): string {
  const { targetKeyRoot } = computeMidpointKey(keyA, modeA, keyB, modeB);
  const triadsA = getDiatonicTriadSymbols(keyA, modeA).filter(
    (c) => !c.endsWith("dim")
  );
  const triadsB = new Set(
    getDiatonicTriadSymbols(keyB, modeB).filter((c) => !c.endsWith("dim"))
  );

  const shared = Array.from(new Set(triadsA.filter((c) => triadsB.has(c))));

  // Dominant root (V) of targetKeyRoot is +1 step clockwise on Circle of Fifths
  const targetCircleIdx = circleOfFifthsIndex(targetKeyRoot);
  const dominantRoot = CIRCLE_OF_FIFTHS[(targetCircleIdx + 1) % 12];

  if (shared.length > 0) {
    shared.sort((chordX, chordY) => {
      const rootX = extractChordRoot(chordX);
      const rootY = extractChordRoot(chordY);

      // Prefer non-tonic chords when keys are identical so the pivot creates harmonic motion
      const isTargetTonicX = rootX === targetKeyRoot ? 1 : 0;
      const isTargetTonicY = rootY === targetKeyRoot ? 1 : 0;
      if (isTargetTonicX !== isTargetTonicY) {
        return isTargetTonicX - isTargetTonicY;
      }

      // Prefer chords closest to the dominant/subdominant axis of targetKeyRoot
      const distDomX = circleOfFifthsDistance(rootX, dominantRoot);
      const distDomY = circleOfFifthsDistance(rootY, dominantRoot);
      if (distDomX !== distDomY) {
        return distDomX - distDomY;
      }

      const distTargetX = circleOfFifthsDistance(rootX, targetKeyRoot);
      const distTargetY = circleOfFifthsDistance(rootY, targetKeyRoot);
      if (distTargetX !== distTargetY) {
        return distTargetX - distTargetY;
      }

      const idxX = circleOfFifthsIndex(rootX);
      const idxY = circleOfFifthsIndex(rootY);
      if (idxX !== idxY) {
        return idxX - idxY;
      }

      return chordX.localeCompare(chordY);
    });

    return shared[0];
  }

  // Distant keys with no common diatonic triads: use dominant 7sus4 of targetKeyRoot
  return `${dominantRoot}7sus4`;
}
