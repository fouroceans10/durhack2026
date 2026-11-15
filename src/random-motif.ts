import type { StartingMotif } from './melody';
import { normalizeRhythm, noteValues, onsetGap, type Articulation } from './phrasing';

// One shared starting idea, chosen locally; agents develop it independently later.
export function generateStartingMotif(previous?: StartingMotif, random = Math.random): StartingMotif {
  const pick = (count: number) => Math.floor(random() * count);
  const length = 4 + pick(5);
  const motif = [[0, 2, 4, 5][pick(4)]];
  for (let i = 1; i < length; i++) {
    const next = motif[i - 1] + [-2, -1, -1, 1, 1, 2][pick(6)];
    // Reflect at the register edges instead of jumping an octave when wrapping.
    motif.push(next < 0 ? -next : next > 6 ? 12 - next : next);
  }
  // Begin with a connected pair rather than an isolated note followed by a random gap.
  const second = 1 + pick(2);
  const available = Array.from({ length: 14 - second }, (_, i) => i + second + 1);
  for (let i = available.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [available[i], available[j]] = [available[j], available[i]];
  }
  const rhythm = [0, second, ...available.slice(0, length - 2).sort((a, b) => a - b)];
  // A reroll always changes something, including when randomness repeats exactly.
  if (previous && JSON.stringify({ motif, rhythm }) === JSON.stringify({ motif: previous.motif, rhythm: previous.rhythm })) {
    motif[motif.length - 1] = (motif.at(-1)! + 1) % 7;
  }
  const durations = rhythm.map((_, i) => { const values = noteValues.filter(n => n <= onsetGap(rhythm, i)); return values[pick(values.length)]; });
  durations[0] = second === 1 ? 1 : 2;
  const articulation: Articulation = ['normal', 'legato', 'staccato'][pick(3)] as Articulation;
  return { motif, ...normalizeRhythm({ rhythm, durations, articulations: rhythm.map((_, i) => i === 0 ? 'legato' : i === rhythm.length - 1 ? 'tenuto' : articulation) }) };
}
