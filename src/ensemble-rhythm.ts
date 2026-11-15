import type { Musician } from './engine';
import { orchestra } from './orchestra';
import { normalizeRhythm, type Articulation } from './phrasing';

export function rhythmicDrive(self: Musician, peers: Musician[]) {
  const drums = peers.filter(p => p.id !== self.id && p.audible
    && ['kick', 'snare', 'cymbal', 'triangle'].includes(orchestra[p.instrument].voice)
    && p.recentNotes.some(n => n.step >= p.beat - 32));
  const energy = drums.length ? .35 * self.energy + .65 * drums.reduce((sum, p) => sum + p.energy, 0) / drums.length : self.energy;
  return { energy, hasDrums: drums.length > 0 };
}

// Fallback accompaniment has an identifiable pulse, plus space or syncopation
// according to the musicians it can actually hear. Refresh only at bar boundaries.
export function ensembleRhythm(m: Musician, peers: Musician[], gesture = 'plain') {
  const profile = orchestra[m.instrument], drive = rhythmicDrive(m, peers);
  const tier = drive.energy >= .7 ? 2 : drive.energy >= .45 ? 1 : 0;
  const variant = (m.instrument + Math.floor(m.beat / 32)) % 2;
  let patterns: number[][];
  if (profile.voice === 'kick') patterns = [[0, 8], [0, 8, 10], [0, 3, 8, 10, 14]];
  else if (profile.voice === 'snare') patterns = [[4, 12], [4, 10, 12], [4, 7, 12, 15]];
  else if (profile.voice === 'cymbal') patterns = [[0], [0, 8], [0, 6, 8, 14]];
  else if (profile.voice === 'triangle') patterns = [[6, 14], [2, 6, 10, 14], [0, 2, 6, 8, 10, 14]];
  else if (profile.base <= 36) patterns = [[0, 8], [0, 4, 8, 12], [0, 3, 4, 8, 11, 12, 14]];
  else if (profile.name === 'Piano') patterns = [[0, 8], [0, 6, 8], [0, 3, 6, 8, 11, 14]];
  else patterns = drive.hasDrums
    ? [[0, 6, 12], [0, 3, 6, 8, 12], [0, 2, 3, 6, 8, 10, 11, 14]]
    : [[0, 8], [0, 4, 10, 14], [0, 2, 4, 6, 8, 10, 12, 14]];
  const rhythm = [...patterns[tier]];
  // Alternate a pickup without displacing kick/snare anchors. Low-energy
  // percussion can keep its pulse; its ghost-note dynamics still phrase it.
  if (variant && rhythm.length < 16) {
    const last = rhythm.at(-1)!;
    const pickup = last < 14 ? last + 2 : last === 14 ? 15 : 2;
    if (!rhythm.includes(pickup)) rhythm.push(pickup);
  }
  rhythm.sort((a, b) => a - b);
  const articulations = rhythm.map<Articulation>(step => step % 4 === 0 ? 'tenuto' : drive.hasDrums || profile.section === 'Percussion' ? 'staccato' : 'normal');
  return normalizeRhythm({ rhythm, articulations }, gesture);
}
