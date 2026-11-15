// Written durations use the same sixteenth-note unit as the 16-step bar.
export const noteValues = [1, 2, 3, 4, 6, 8, 12, 16] as const;
export type NoteValue = typeof noteValues[number];
export const noteValueNames: Record<NoteValue, string> = { 1: 'Semiquaver', 2: 'Quaver', 3: 'Dotted quaver', 4: 'Crotchet', 6: 'Dotted crotchet', 8: 'Minim', 12: 'Dotted minim', 16: 'Semibreve' };
export const articulations = ['normal', 'legato', 'staccato', 'tenuto', 'accent'] as const;
export type Articulation = typeof articulations[number];
export type Phrasing = { durations?: NoteValue[]; articulations?: Articulation[] };
export type RhythmicPhrase = Phrasing & { rhythm: number[] };

// Invitations, not a score: the local model may choose, combine or vary these.
// Rotating examples help a small model escape simply copying its current onsets.
const ideas: (RhythmicPhrase & { name: string })[] = [
  { name: 'Short run into a held answer', rhythm: [0, 1, 3, 6, 10], durations: [1, 2, 3, 4, 6], articulations: ['legato', 'legato', 'staccato', 'normal', 'tenuto'] },
  { name: 'Two sustained minims', rhythm: [0, 8], durations: [8, 8], articulations: ['legato', 'tenuto'] },
  { name: 'Dotted syncopation', rhythm: [0, 3, 4, 8, 14], durations: [3, 1, 4, 4, 2], articulations: ['legato', 'staccato', 'accent', 'normal', 'staccato'] },
  { name: 'A reply with breathing spaces', rhythm: [0, 6, 12], durations: [4, 2, 2], articulations: ['tenuto', 'normal', 'staccato'] },
  { name: 'Semiquaver burst into quavers', rhythm: [0, 1, 2, 3, 8, 10, 12, 14], durations: [1, 1, 1, 1, 2, 2, 2, 2], articulations: ['legato', 'legato', 'legato', 'staccato', 'normal', 'normal', 'accent', 'staccato'] },
  { name: 'One sustained semibreve', rhythm: [0], durations: [16], articulations: ['tenuto'] },
];
export function phrasingIdeas(instrument: number, beat: number, recentRhythms: number[][]) {
  const offset = (instrument + Math.floor(beat / 16)) % ideas.length;
  return structuredClone([...ideas.slice(offset), ...ideas.slice(0, offset)]
    .filter(idea => !recentRhythms.some(r => r.join() === idea.rhythm.join())).slice(0, 3));
}

export function validPhrasing(value: Phrasing, count: number): boolean {
  return (value.durations === undefined || Array.isArray(value.durations) && value.durations.length === count && value.durations.every(n => noteValues.includes(n)))
    && (value.articulations === undefined || Array.isArray(value.articulations) && value.articulations.length === count && value.articulations.every(a => articulations.includes(a)));
}
export const fitValue = (steps: number): NoteValue => [...noteValues].reverse().find(n => n <= steps) ?? 1;
export const onsetGap = (rhythm: number[], index: number) => (rhythm[index + 1] ?? 16) - rhythm[index];

// Sort/deduplicate the complete events, never the onsets separately from their lengths.
// End at the bar line; explicit shorter values leave rests, including under legato.
export function normalizeRhythm(phrase: RhythmicPhrase, gesture = 'plain', limit = 16) {
  const entries = phrase.rhythm.map((step, i) => ({ step, duration: phrase.durations?.[i], articulation: phrase.articulations?.[i] }))
    .sort((a, b) => a.step - b.step).filter((e, i, all) => i === 0 || e.step !== all[i - 1].step).slice(0, limit);
  const rhythm = entries.map(e => e.step);
  const durations = entries.map((e, i) => fitValue(Math.min(e.duration ?? onsetGap(rhythm, i), onsetGap(rhythm, i))));
  const phrasing = entries.map<Articulation>(e => gesture === 'legato' || gesture === 'staccato' ? gesture : e.articulation ?? 'normal');
  return { rhythm, durations, articulations: phrasing };
}

// Keep fresh model ideas intact. When onsets repeat, change the timing itself,
// carrying each note's articulation and length with it through the edit.
export function avoidRhythmicRepeat(phrase: RhythmicPhrase, recent: number[][], seed: number, gesture = 'plain') {
  const normalized = normalizeRhythm(phrase, gesture);
  const repeats = (rhythm: number[]) => recent.some(previous => previous.join() === rhythm.join());
  if (!repeats(normalized.rhythm)) return normalized;
  const events = normalized.rhythm.map((step, i) => ({ step, duration: normalized.durations[i], articulation: normalized.articulations[i] }));
  for (let variation = 0; variation < 3; variation++) {
    for (let offset = 0; offset < events.length; offset++) {
      const i = (seed + offset) % events.length;
      const edited = events.map(event => ({ ...event }));
      const event = edited[i], next = edited[i + 1]?.step ?? 16;
      switch ((seed + variation) % 3) {
        case 0: { // Split a held note into a connected pair.
          if (event.duration < 2 || events.length === 16) continue;
          const first = fitValue(Math.floor(event.duration / 2));
          edited.splice(i + 1, 0, { ...event, step: event.step + first, duration: fitValue(event.duration - first) });
          event.duration = first;
          break;
        }
        case 1: { // Merge a pair into a longer note, leaving other rests intact.
          if (i + 1 === events.length) continue;
          event.duration = fitValue(next + edited[i + 1].duration - event.step);
          edited.splice(i + 1, 1);
          break;
        }
        case 2: { // Displace an entrance and shorten it to leave breathing room.
          const shift = seed % 2 ? -1 : 1;
          const moved = event.step + shift;
          if (moved < 0 || moved <= (edited[i - 1]?.step ?? -1) || moved >= next) continue;
          event.step = moved;
          event.duration = fitValue(Math.max(1, Math.min(event.duration, next - moved) - 1));
          break;
        }
      }
      const candidate = normalizeRhythm({ rhythm: edited.map(e => e.step), durations: edited.map(e => e.duration), articulations: edited.map(e => e.articulation) }, gesture);
      if (!repeats(candidate.rhythm)) return candidate;
    }
  }
  // Dense or very short phrases may exhaust local edits; use a contrasting cell.
  const alternative = phrasingIdeas(seed, 0, recent)[0];
  return alternative ? normalizeRhythm(alternative, gesture) : normalized;
}

export function soundingDuration(value: number, gap: number, tempo: number, articulation: Articulation, connects = true): number {
  const seconds = value * 60 / tempo / 4;
  if (articulation === 'staccato') return seconds * .4;
  if (articulation === 'tenuto') return seconds;
  if (articulation === 'legato') return seconds + (connects && value >= gap ? Math.min(.04, seconds * .08) : 0);
  return seconds * .85;
}
