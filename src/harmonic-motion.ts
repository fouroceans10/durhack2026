import type { Musician } from './engine';
import { formPosition } from './forms';
import { currentKey, degreePitch, type Mode, type Tonality } from './tonality';

// A shared harmonic vocabulary, evaluated independently on each player's clock.
// Keep roots independent of individual dynamics so a louder player does not
// accidentally choose a different progression from its accompaniment.
const progressions: Record<Mode, readonly number[]> = {
  major: [0, 5, 3, 4], minor: [0, 5, 3, 4], harmonicMinor: [0, 5, 1, 4],
  dorian: [0, 3, 6, 3], phrygian: [0, 1, 6, 0], lydian: [0, 1, 4, 0],
  mixolydian: [0, 6, 3, 0], locrian: [0, 1, 5, 0],
};

export function harmonicMotion(m: Musician) {
  const key = currentKey(m), position = formPosition(m.form, m.beat);
  const structured = position.form !== 'free' && !position.waiting;
  const bar = structured ? position.bar - 1 : Math.floor(m.beat / 16);
  const phase = bar % 4;
  const root = structured && position.cadence ? 0
    : structured && position.bar === position.bars - 1 ? 4 : progressions[key.mode][phase];
  const tension = position.cadence ? 0 : [.18, .38, .68, .4][phase];
  // Stacking scale thirds keeps extensions valid in all supported modes.
  const degrees = [root, root + 2, root + 4, ...(tension >= .6 ? [root + 6] : [])];
  return { root, degrees, tension };
}

// Choose a close inversion from actual played pitches, including after a key
// change. No hidden mutable voicing state is needed on network peers.
export function voiceChord(base: number, degrees: readonly number[], key: Tonality, previous: readonly number[] = []): number[] {
  const notes = degrees.map(degree => degreePitch(base, degree, key));
  const candidates: number[][] = [];
  for (let inversion = 0; inversion < notes.length; inversion++) {
    const inverted = notes.map((note, i) => note + (i < inversion ? 12 : 0)).sort((a, b) => a - b);
    for (const octave of [-12, 0, 12]) {
      const candidate = inverted.map(note => note + octave);
      if (candidate.every(note => note >= base + key.tonic && note <= base + key.tonic + 24)) candidates.push(candidate);
    }
  }
  const reference = [...previous].sort((a, b) => a - b);
  const score = (candidate: number[]) => reference.length
    ? candidate.reduce((sum, note, i) => sum + Math.abs(note - reference[Math.round(i * (reference.length - 1) / (candidate.length - 1))]), 0) / candidate.length
    : candidate.reduce((sum, note, i) => sum + Math.abs(note - notes[i]), 0);
  return candidates.sort((a, b) => score(a) - score(b) || a[0] - b[0])[0] ?? notes;
}
