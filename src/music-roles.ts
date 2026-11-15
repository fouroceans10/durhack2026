import { orchestra } from './orchestra';
import type { InstrumentRole } from './music-core/types';

// Preserve each instrument's samples and register while sharing four arranging roles.
export function musicRole(instrument: number): InstrumentRole {
  const p = orchestra[instrument];
  if (['snare', 'kick', 'cymbal', 'triangle'].includes(p.voice)) return 'drums';
  if (['Cello', 'Double bass', 'Bass clarinet', 'Bassoon', 'Contrabassoon', 'Bass trombone', 'Tuba', 'Timpani'].includes(p.name)) return 'bass';
  if (['Viola', 'French horn', 'Trombone', 'Harp', 'Piano', 'Celesta'].includes(p.name)) return 'piano';
  return 'lead';
}
