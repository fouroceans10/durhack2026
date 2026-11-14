import { validTonality, type Tonality } from './tonality';
import { validPhrasing, type Phrasing } from './phrasing';
export const formIds = ['free', 'aba', 'abb', 'pop', 'classical'] as const;
export type FormId = typeof formIds[number];
export type FormChoice = FormId | 'auto';
export const gestures = ['plain', 'arpeggio', 'mordent', 'trill', 'ostinato', 'legato', 'staccato'] as const;
export type Gesture = typeof gestures[number];
export const themeActions = ['develop', 'recall', 'contrast'] as const;
export type ThemeAction = typeof themeActions[number];
export type Theme = Phrasing & { motif: number[]; rhythm: number[]; energy: number; tonality?: Tonality };
export type FormSettings = { choice: FormChoice; bars: number; expression?: 'auto' | Gesture };
export type FormState = FormSettings & {
  selected?: FormId; startBeat: number; home: Theme; themes: Record<string, Theme>;
  token?: string; enteredAt?: number; gesture: Gesture;
};
export type FormSection = { label: string; theme: string; intention: string; energy: number; tempo: number; gesture: Gesture; movement: number; movementName: string };
const section = (label: string, theme: string, intention: string, energy = .5, gesture: Gesture = 'plain', tempo = 112, movement = 1, movementName = 'One movement'): FormSection => ({ label, theme, intention, energy, gesture, tempo, movement, movementName });
export const formNames: Record<FormChoice, string> = { auto: 'Agent choice', free: 'Free development', aba: 'ABA · return to the theme', abb: 'ABB · repeat the contrast', pop: 'Pop · verse / chorus / bridge', classical: 'Classical · four movements' };
export const formPlans: Record<FormId, FormSection[]> = {
  free: [section('Free', 'A', 'Listen and develop freely.')],
  aba: [section('A', 'A', 'Establish a recognizable theme.'), section('B', 'B', 'Contrast the theme with a different contour and texture.', .62, 'arpeggio'), section('A return', 'A', 'Bring back the remembered A theme and resolve.', .48, 'legato')],
  abb: [section('A', 'A', 'Introduce the theme.'), section('B', 'B', 'Create a contrasting answer.', .6, 'arpeggio'), section('B repeat', 'B', 'Repeat the remembered B answer with small ornaments.', .58, 'mordent')],
  pop: [section('Intro', 'I', 'Introduce a sparse fragment.', .3, 'legato'), section('Verse', 'A', 'Leave space for a lyrical melody.', .44), section('Chorus', 'B', 'Make a strong, repeatable hook.', .72, 'ostinato'), section('Verse', 'A', 'Return to the verse theme with space.', .44), section('Chorus', 'B', 'Recall the chorus hook.', .72, 'ostinato'), section('Bridge', 'C', 'Contrast the verse and chorus.', .52, 'arpeggio'), section('Final chorus', 'B', 'Return to the hook with more energy.', .8, 'ostinato'), section('Outro', 'I', 'Thin the texture and bring the opening back.', .28, 'legato')],
  classical: [
    section('Theme A', 'A', 'Present the first theme.', .56, 'arpeggio', 124, 1, 'I · Allegro'),
    section('Theme B', 'B', 'Present a contrasting second theme.', .5, 'legato', 124, 1, 'I · Allegro'),
    section('Development', 'D', 'Fragment and transform both themes.', .72, 'arpeggio', 124, 1, 'I · Allegro'),
    section('A reprise', 'A', 'Recall the first theme.', .58, 'plain', 124, 1, 'I · Allegro'),
    section('B reprise', 'B', 'Recall the second theme and close the movement.', .5, 'legato', 124, 1, 'I · Allegro'),
    ...['A', 'B', 'A'].map((theme, i) => section(i === 2 ? 'A return' : theme, theme, 'Shape a slower, singing line with breathing room.', .32, 'legato', 88, 2, 'II · Adagio')),
    ...['A', 'B', 'A'].map((theme, i) => section(i === 2 ? 'A return' : theme, theme, 'Use light, playful articulation and short ornaments.', .5, 'mordent', 116, 3, 'III · Scherzo')),
    ...['A', 'B', 'A', 'C', 'A'].map((theme, i) => section(theme === 'A' && i ? 'A return' : theme, theme, 'Alternate the refrain with contrasting episodes; build a finale.', .7, 'arpeggio', 136, 4, 'IV · Rondo finale')),
  ],
};
export function validFormSettings(value: FormSettings): boolean {
  return ['auto', ...formIds].includes(value.choice) && [4, 8, 16, 32].includes(value.bars)
    && (value.expression === undefined || value.expression === 'auto' || gestures.includes(value.expression));
}
export function makeForm(settings: FormSettings, theme: Theme, startBeat: number): FormState {
  if (!validFormSettings(settings)) throw new Error('Invalid musical form settings.');
  return { choice: settings.choice, bars: settings.bars, expression: settings.expression,
    selected: settings.choice === 'auto' ? undefined : settings.choice, startBeat,
    home: structuredClone(theme), themes: {}, gesture: settings.expression && settings.expression !== 'auto' ? settings.expression : 'plain' };
}
export function formPosition(form: FormState | undefined, beat: number) {
  const id = form?.selected ?? 'free', plan = formPlans[id];
  const length = (form?.bars ?? 8) * 16;
  const elapsed = Math.max(0, beat - (form?.startBeat ?? 0));
  const ordinal = id === 'free' ? 0 : Math.floor(elapsed / length);
  const index = ordinal % plan.length, cycle = Math.floor(ordinal / plan.length) + 1;
  const current = plan[index], themeKey = `${current.movement}:${current.theme}`;
  const waiting = !!form && (beat < form.startBeat || !form.selected);
  return { ...current, form: id, index, cycle, themeKey, waiting,
    token: `${id}:${cycle}:${index}:${form?.startBeat ?? 0}:${form?.bars ?? 8}`,
    bar: Math.floor(elapsed % length / 16) + 1, bars: form?.bars ?? 8,
    returning: plan.slice(0, index).some(s => s.theme === current.theme && s.movement === current.movement) || cycle > 1,
    cadence: id !== 'free' && elapsed % length >= length - 16,
  };
}
export function validForm(value: unknown, beat: number): value is FormState {
  if (!value || typeof value !== 'object') return false;
  const f = value as FormState;
  const theme = (t: Theme) => t && Array.isArray(t.motif) && t.motif.length > 0 && t.motif.length <= 12 && t.motif.every(n => Number.isInteger(n) && n >= 0 && n < 7)
    && Array.isArray(t.rhythm) && t.rhythm.length > 0 && t.rhythm.length <= 16 && new Set(t.rhythm).size === t.rhythm.length && t.rhythm.every(n => Number.isInteger(n) && n >= 0 && n < 16)
    && validPhrasing(t, t.rhythm.length) && Number.isFinite(t.energy) && t.energy >= 0 && t.energy <= 1 && (t.tonality === undefined || validTonality(t.tonality));
  return validFormSettings(f) && (f.selected === undefined || formIds.includes(f.selected))
    && (f.choice === 'auto' || f.choice === f.selected)
    && Number.isSafeInteger(f.startBeat) && f.startBeat >= 0 && f.startBeat <= beat + 32 && f.startBeat % 16 === 0
    && (f.enteredAt === undefined || Number.isSafeInteger(f.enteredAt) && f.enteredAt >= 0 && f.enteredAt <= beat)
    && (f.token === undefined || typeof f.token === 'string' && f.token.length < 100)
    && gestures.includes(f.gesture) && theme(f.home) && !!f.themes && typeof f.themes === 'object' && !Array.isArray(f.themes)
    && Object.keys(f.themes).length <= 24 && Object.entries(f.themes).every(([key, value]) => /^[1-4]:[ABCDI]$/.test(key) && theme(value));
}
