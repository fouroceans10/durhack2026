import { describe, expect, it } from "vitest";
import type { MusicalMode } from "../../../../shared/types";
import {
  CIRCLE_OF_FIFTHS,
  circleOfFifthsDistance,
  circleOfFifthsIndex,
  computeMidpointKey,
  computePivotChord,
  getDiatonicTriadSymbols,
  normalizePitchClass,
  pitchClassToSemitone,
  semitoneToPitchClass,
  signatureCircleIndex,
  signedCircleSteps,
} from "../circleOfFifths";

const MODES: readonly MusicalMode[] = ["major", "minor", "dorian"];

describe("circleOfFifths module", () => {
  it("normalizes enharmonic equivalents and strips octave numbers", () => {
    expect(normalizePitchClass("C")).toBe("C");
    expect(normalizePitchClass("db")).toBe("C#");
    expect(normalizePitchClass("D#4")).toBe("Eb");
    expect(normalizePitchClass("Gb3")).toBe("F#");
    expect(normalizePitchClass("G#")).toBe("Ab");
    expect(normalizePitchClass("A#")).toBe("Bb");
    expect(normalizePitchClass("Cb")).toBe("B");
    expect(normalizePitchClass("B#")).toBe("C");
    expect(() => normalizePitchClass("")).toThrow();
    expect(() => normalizePitchClass("H#")).toThrow();
  });

  it("maps pitch classes to semitones and back cyclically", () => {
    expect(pitchClassToSemitone("C")).toBe(0);
    expect(pitchClassToSemitone("G")).toBe(7);
    expect(pitchClassToSemitone("Bb")).toBe(10);
    expect(semitoneToPitchClass(0)).toBe("C");
    expect(semitoneToPitchClass(12)).toBe("C");
    expect(semitoneToPitchClass(-1)).toBe("B");
    expect(semitoneToPitchClass(19)).toBe("G");
  });

  it("computes Circle of Fifths indices, distances, and relative mode signatures", () => {
    expect(circleOfFifthsIndex("C")).toBe(0);
    expect(circleOfFifthsIndex("G")).toBe(1);
    expect(circleOfFifthsIndex("F")).toBe(11);

    // Relative keys share the same signatureCircleIndex
    expect(signatureCircleIndex("C", "major")).toBe(0);
    expect(signatureCircleIndex("A", "minor")).toBe(0);
    expect(signatureCircleIndex("D", "dorian")).toBe(0);

    expect(circleOfFifthsDistance("C", "G")).toBe(1);
    expect(circleOfFifthsDistance("C", "F")).toBe(1);
    expect(circleOfFifthsDistance("C", "F#")).toBe(6);

    expect(signedCircleSteps("C", "D")).toBe(2);
    expect(signedCircleSteps("D", "C")).toBe(-2);
    expect(signedCircleSteps("C", "F#")).toBe(6);
  });

  it("computes expected midpoints on the Circle of Fifths", () => {
    // C (0) and D (2) -> midpoint G (1)
    expect(computeMidpointKey("C", "major", "D", "major")).toEqual({
      targetKeyRoot: "G",
      targetMode: "major",
    });

    // Major and Minor bridge through Dorian
    expect(computeMidpointKey("C", "major", "A", "minor")).toEqual({
      targetKeyRoot: "G",
      targetMode: "dorian",
    });
  });

  it("is 100% commutative across all 1,296 (keyA, modeA, keyB, modeB) combinations", () => {
    for (const keyA of CIRCLE_OF_FIFTHS) {
      for (const modeA of MODES) {
        for (const keyB of CIRCLE_OF_FIFTHS) {
          for (const modeB of MODES) {
            const forwardMid = computeMidpointKey(keyA, modeA, keyB, modeB);
            const reverseMid = computeMidpointKey(keyB, modeB, keyA, modeA);
            expect(forwardMid).toEqual(reverseMid);

            const forwardPivot = computePivotChord(keyA, modeA, keyB, modeB);
            const reversePivot = computePivotChord(keyB, modeB, keyA, modeA);
            expect(forwardPivot).toBe(reversePivot);
            expect(forwardPivot.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("selects a shared diatonic triad when bridging closely related keys", () => {
    const triadsC = getDiatonicTriadSymbols("C", "major");
    const triadsG = getDiatonicTriadSymbols("G", "major");
    const pivot = computePivotChord("C", "major", "G", "major");

    expect(triadsC).toContain(pivot);
    expect(triadsG).toContain(pivot);
  });

  it("constructs a dominant 7sus4 pivot chord when keys share zero diatonic triads", () => {
    // C major and F# major are a tritone apart and share zero non-diminished triads
    const pivot = computePivotChord("C", "major", "F#", "major");
    expect(pivot).toMatch(/7sus4$/);
  });
});
