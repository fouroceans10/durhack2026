import { formIds, gestures, themeActions, type FormId, type Gesture, type ThemeAction } from './forms';
import { keyChanges, validTonality, type KeyChange, type Tonality } from './tonality';
import { articulations, noteValues, validPhrasing, type Phrasing } from './phrasing';
import { melodicVariations, type MelodicVariation } from './melodic-variation';
export const approaches = ['echo', 'counterpoint', 'support', 'contrast', 'develop'] as const;
export type MusicalStrategy = Phrasing & {
  rhythm: number[];
  energy: number;
  approach: typeof approaches[number];
  interval: number;
  reason: string;
  respondTo: string;
  // Optional on older peer messages; required by the current model response schema.
  form?: FormId; gesture?: Gesture; themeAction?: ThemeAction;
  keyChange?: KeyChange;
  variation?: MelodicVariation;
};
export type MelodyDecision = MusicalStrategy & { motif: number[]; tonality?: Tonality };
export type StartingMotif = Phrasing & { motif: number[]; rhythm: number[]; tonality?: Tonality };
export function validStartingMotif(value: StartingMotif): boolean {
  return (value.tonality === undefined || validTonality(value.tonality)) && Array.isArray(value.motif) && value.motif.length >= 1 && value.motif.length <= 12
    && value.motif.every(n => Number.isInteger(n) && n >= 0 && n < 7)
    && Array.isArray(value.rhythm) && value.rhythm.length === value.motif.length
    && value.rhythm.every((n, i) => Number.isInteger(n) && n >= 0 && n < 16 && (i === 0 || n > value.rhythm[i - 1])) && validPhrasing(value, value.rhythm.length);
}
export const strategySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    respondTo: { type: 'string', minLength: 1, maxLength: 60 },
    approach: { type: 'string', enum: approaches },
    interval: { type: 'integer', minimum: -2, maximum: 2 },
    variation: { type: 'string', enum: melodicVariations },
    rhythm: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'integer', minimum: 0, maximum: 15 } },
    durations: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'integer', enum: noteValues } },
    articulations: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', enum: articulations } },
    energy: { type: 'number', minimum: .2, maximum: .9 },
    reason: { type: 'string', minLength: 1, maxLength: 180 },
    form: { type: 'string', enum: formIds },
    gesture: { type: 'string', enum: gestures },
    themeAction: { type: 'string', enum: themeActions },
    keyChange: { type: 'string', enum: keyChanges },
  },
  required: ['respondTo', 'approach', 'interval', 'variation', 'rhythm', 'durations', 'articulations', 'energy', 'reason', 'form', 'gesture', 'themeAction', 'keyChange'],
};
export function validStrategy(value: unknown): value is MusicalStrategy {
  if (!value || typeof value !== 'object') return false;
  const d = value as MusicalStrategy;
  if (d.variation !== undefined && !melodicVariations.includes(d.variation)) return false;
  if (d.keyChange !== undefined && !keyChanges.includes(d.keyChange)) return false;
  if ((d.form !== undefined && !formIds.includes(d.form)) || (d.gesture !== undefined && !gestures.includes(d.gesture)) || (d.themeAction !== undefined && !themeActions.includes(d.themeAction))) return false;
  return Array.isArray(d.rhythm) && d.rhythm.length >= 1 && d.rhythm.length <= 16 && d.rhythm.every(n => Number.isInteger(n) && n >= 0 && n <= 15)
    && validPhrasing(d, d.rhythm.length)
    && Number.isFinite(d.energy) && d.energy >= .2 && d.energy <= .9 && approaches.includes(d.approach)
    && Number.isInteger(d.interval) && d.interval >= -2 && d.interval <= 2
    && typeof d.respondTo === 'string' && d.respondTo.length > 0 && d.respondTo.length <= 60
    && typeof d.reason === 'string' && d.reason.trim().length > 0 && d.reason.length <= 180;
}
export function validDecision(value: unknown): value is MelodyDecision {
  if (!validStrategy(value)) return false;
  const d = value as MelodyDecision;
  if (d.tonality !== undefined && !validTonality(d.tonality)) return false;
  return Array.isArray(d.motif) && d.motif.length >= 1 && d.motif.length <= 12 && d.motif.every(n => Number.isInteger(n) && n >= 0 && n <= 6)
    && new Set(d.rhythm).size === d.rhythm.length;
}
