import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RATE,
  adaptMotif,
  extractMotif,
  generateStartingMotif,
  nearestDegree,
  toMotifRecord,
} from "../motifExtraction";
import { encodeWavFile } from "../motifUpload";

function synthesizePcmRecording(
  midiNotes: number[],
  gapSec = 0.06,
  leadingSec = 0.2,
): Float32Array {
  const noteLen = 0.32 + gapSec;
  const totalSamples = Math.ceil(
    (leadingSec + midiNotes.length * noteLen + 0.2) * ANALYSIS_RATE,
  );
  const pcm = new Float32Array(totalSamples);

  midiNotes.forEach((midi, index) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const noteSamples = Math.floor(0.32 * ANALYSIS_RATE);
    const startOffset = Math.floor((leadingSec + index * noteLen) * ANALYSIS_RATE);
    for (let i = 0; i < noteSamples; i++) {
      const time = i / ANALYSIS_RATE;
      const envelope = Math.min(1, time / 0.015, (0.32 - time) / 0.02);
      pcm[startOffset + i] =
        envelope *
        (0.3 * Math.sin(2 * Math.PI * frequency * time) +
          0.1 * Math.sin(4 * Math.PI * frequency * time));
    }
  });

  return pcm;
}

describe("Voice Recording & Audio Motif Extraction (Pitchy DSP)", () => {
  it("extracts a real PCM melody with leading silence, harmonics, and relative entrances", () => {
    const pcm = synthesizePcmRecording([60, 64, 67, 65, 62]);
    const result = extractMotif(pcm, ANALYSIS_RATE, undefined, "C", "major");

    expect(result.motif).toEqual([0, 2, 4, 3, 1]);
    expect(result.notes.map((n) => n.midi)).toEqual([60, 64, 67, 65, 62]);
    expect(result.rhythm[0]).toBe(0);
    expect(result.waveform).toHaveLength(100);
    expect(result.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it("rejects silence, noise, clicks, and out-of-range durations", () => {
    expect(() =>
      extractMotif(new Float32Array(ANALYSIS_RATE), ANALYSIS_RATE),
    ).toThrow(/No clear melody/);

    let seed = 17;
    const noise = Float32Array.from({ length: ANALYSIS_RATE }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed / 2147483648) * 0.3;
    });
    expect(() => extractMotif(noise, ANALYSIS_RATE)).toThrow(/No clear melody/);

    const click = new Float32Array(ANALYSIS_RATE);
    click[500] = 1;
    expect(() => extractMotif(click, ANALYSIS_RATE)).toThrow(/No clear melody/);

    expect(() =>
      extractMotif(new Float32Array(ANALYSIS_RATE * 31), ANALYSIS_RATE),
    ).toThrow(/30 seconds/);
    expect(() => extractMotif(new Float32Array(100), ANALYSIS_RATE)).toThrow(
      /0.25/,
    );
  });

  it("fits chromatic pitches to the active scale and adapts extracted motifs across keys", () => {
    expect(nearestDegree(60, "C", "major")).toBe(0);
    expect(nearestDegree(72, "C", "major")).toBe(0);
    expect(nearestDegree(69, "A", "minor")).toBe(0);

    const pcm = synthesizePcmRecording([60, 64, 67]);
    const extracted = extractMotif(pcm, ANALYSIS_RATE, undefined, "C", "major");
    const adaptedToG = adaptMotif(extracted, "G", "major");
    expect(adaptedToG.keyRoot).toBe("G");
    expect(adaptedToG.motif).toHaveLength(3);
  });

  it("encodes recorded voice PCM to a valid RIFF WAV file and converts phrases to MotifRecord", () => {
    const pcm = synthesizePcmRecording([60, 62, 64]);
    const wavFile = encodeWavFile(pcm, ANALYSIS_RATE, "voice-test.wav");
    expect(wavFile.name).toBe("voice-test.wav");
    expect(wavFile.type).toBe("audio/wav");
    expect(wavFile.size).toBe(44 + pcm.length * 2);

    const phrase = generateStartingMotif(undefined, "D", "dorian");
    const record = toMotifRecord(
      phrase,
      "lead",
      "part:lead-piano",
      118,
      "Voice Test",
    );
    expect(record.authorRole).toBe("lead");
    expect(record.keyRoot).toBe("D");
    expect(record.mode).toBe("dorian");
    expect(record.scaleDegrees.length).toBeGreaterThanOrEqual(4);
  });
});
