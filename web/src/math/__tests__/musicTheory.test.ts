import { describe, expect, it } from "vitest";
import type { MotifRecord } from "../../../../shared/types";
import {
  getDiatonicChord,
  getDiatonicProgression,
  getScaleNotes,
  midiToFrequency,
  midiToNoteName,
  parseChordSymbol,
  realizeMotifNotes,
  scaleDegreeToMidi,
  scaleDegreeToNoteName,
  transposeMotif,
} from "../musicTheory";

describe("musicTheory module", () => {
  it("generates accurate 7-note diatonic scales for major, minor, and dorian", () => {
    expect(getScaleNotes("C", "major")).toEqual([
      "C",
      "D",
      "E",
      "F",
      "G",
      "A",
      "B",
    ]);
    expect(getScaleNotes("A", "minor")).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
    expect(getScaleNotes("D", "dorian")).toEqual([
      "D",
      "E",
      "F",
      "G",
      "A",
      "B",
      "C",
    ]);
  });

  it("maps positive, zero, negative, and multi-octave scale degrees to MIDI and note names", () => {
    expect(scaleDegreeToMidi(0, "C", "major", 4)).toBe(60); // C4
    expect(scaleDegreeToMidi(4, "C", "major", 4)).toBe(67); // G4
    expect(scaleDegreeToMidi(7, "C", "major", 4)).toBe(72); // C5
    expect(scaleDegreeToMidi(-1, "C", "major", 4)).toBe(59); // B3
    expect(scaleDegreeToMidi(-7, "C", "major", 4)).toBe(48); // C3

    expect(scaleDegreeToNoteName(0, "C", "major", 4)).toBe("C4");
    expect(scaleDegreeToNoteName(2, "A", "minor", 4)).toBe("C5");
    expect(midiToNoteName(69)).toBe("A4");
    expect(midiToFrequency(69)).toBe(440);
  });

  it("parses chord symbols and constructs diatonic triads and sevenths", () => {
    const cmaj7 = parseChordSymbol("Cmaj7", 4);
    expect(cmaj7.root).toBe("C");
    expect(cmaj7.quality).toBe("maj7");
    expect(cmaj7.pitchClasses).toEqual(["C", "E", "G", "B"]);
    expect(cmaj7.midiNotes).toEqual([60, 64, 67, 71]);

    const iiChord = getDiatonicChord("C", "major", 1, true, 3);
    expect(iiChord.symbol).toBe("Dm7");
    expect(iiChord.pitchClasses).toEqual(["D", "F", "A", "C"]);

    const vChord = getDiatonicChord("C", "major", 4, true, 3);
    expect(vChord.symbol).toBe("G7");
  });

  it("generates tension-appropriate 4-bar diatonic progressions", () => {
    const lowTension = getDiatonicProgression("C", "major", 0.1);
    expect(lowTension).toEqual(["C", "G", "Am", "F"]);

    const highTension = getDiatonicProgression("C", "major", 0.85);
    expect(highTension).toEqual(["Dm7", "G7", "Em7", "Am7"]);
  });

  it("realizes and transposes MotifRecords deterministically", () => {
    const motif: MotifRecord = {
      id: "motif-lead-1",
      authorRole: "lead",
      createdDuringPartitionId: "part-A",
      scaleDegrees: [0, 2, 4, 7, 5, 4, 2, 0],
      rhythmSteps: [0, 2, 4, 6, 8, 10, 12, 14],
      keyRoot: "C",
      mode: "major",
      bpm: 120,
    };

    const eventsC = realizeMotifNotes(motif, "C", "major", 4);
    expect(eventsC).toHaveLength(8);
    expect(eventsC[0].noteName).toBe("C4");
    expect(eventsC[3].noteName).toBe("C5");

    const transposed = transposeMotif(motif, "G", "dorian", 128);
    expect(transposed.keyRoot).toBe("G");
    expect(transposed.mode).toBe("dorian");
    expect(transposed.bpm).toBe(128);
    expect(transposed.scaleDegrees).toEqual(motif.scaleDegrees);

    const eventsG = realizeMotifNotes(transposed);
    expect(eventsG[0].noteName).toBe("G4");
    expect(eventsG[1].noteName).toBe("Bb4"); // 3rd degree of G dorian is Bb
  });
});
