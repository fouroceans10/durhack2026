export const melodicVariations = ['keep', 'sequence', 'invert', 'reverse', 'turn'] as const;
export type MelodicVariation = typeof melodicVariations[number];

// Reflect at the scale's edges so a small step does not become an octave leap.
const reflect = (degree: number) => {
  const folded = (degree % 12 + 12) % 12;
  return folded > 6 ? 12 - folded : folded;
};

export function transformMelody(motif: number[], variation: MelodicVariation = 'keep', seed = 0): number[] {
  const direction = seed % 2 ? -1 : 1;
  const cell = 2 + seed % 2;
  const offset = Math.floor(seed / 4);
  switch (variation) {
    case 'keep': return [...motif];
    case 'reverse': return [...motif].reverse();
    case 'invert': return motif.map(note => reflect(2 * motif[0] - note));
    case 'sequence': return motif.map((_, i) => reflect(motif[(i % cell + offset) % motif.length] + direction * Math.floor(i / cell)));
    case 'turn': return motif.map((note, i) => reflect(note + direction * [0, 1, 0, -1][(i + offset) % 4]));
  }
}

// Compare the notes that can actually sound in the first bar, rather than only
// the tail of an eight-note motif that might be replaced before it is played.
export function avoidMelodicRepeat(motif: number[], recent: number[][], onsets: number, seed: number): number[] {
  const count = Math.min(onsets, motif.length);
  const references = recent.filter(notes => notes.length);
  if (!count || !references.length) return [...motif];
  const distance = (candidate: number[]) => Math.min(...references.map(notes =>
    candidate.slice(0, count).filter((note, i) => note !== notes[i % notes.length]).length));
  const needed = Math.ceil(count / 3);
  let best = [...motif], score = distance(best);
  if (score >= needed) return best;

  // Try related contours before transposing them. This is bounded and stable
  // for a given musician/bar, with no shared randomness between the agents.
  const alternatives = melodicVariations.filter(variation => variation !== 'keep');
  for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
    for (let i = 0; i < alternatives.length; i++) {
      const variation = alternatives[(seed + i) % alternatives.length];
      const candidate = transformMelody(motif, variation, seed).map(note => reflect(note + shift));
      const changed = distance(candidate);
      if (changed > score) { best = candidate; score = changed; }
      if (score >= needed) return best;
    }
  }
  return best;
}
