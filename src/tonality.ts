export const modes = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
} as const;
export type Mode = keyof typeof modes;
export type Tonality = { tonic: number; mode: Mode };
export const modeNames: Record<Mode, string> = { major: 'major', minor: 'natural minor', harmonicMinor: 'harmonic minor', dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian', locrian: 'Locrian' };
export const tonicNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const DEFAULT_TONALITY: Tonality = { tonic: 0, mode: 'major' };
export const modulationNames = { fixed: 'Stay in the home key', form: 'Follow the form', agent: 'Let agents modulate' } as const;
export type Modulation = keyof typeof modulationNames;
export const keyChanges = ['stay', 'home', 'dominant', 'subdominant', 'relative', 'parallel'] as const;
export type KeyChange = typeof keyChanges[number];
export type HarmonyState = { home: Tonality; current: Tonality; modulation: Modulation; changedIn?: string };
export const sameKey = (a: Tonality, b: Tonality) => a.tonic === b.tonic && a.mode === b.mode;
export const keyName = (key: Tonality) => `${tonicNames[key.tonic]} ${modeNames[key.mode]}`;
export function validTonality(value: unknown): value is Tonality {
  if (!value || typeof value !== 'object') return false;
  const key = value as Tonality;
  return Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12 && typeof key.mode === 'string' && Object.hasOwn(modes, key.mode);
}
export function validHarmony(value: unknown): value is HarmonyState {
  if (!value || typeof value !== 'object') return false;
  const h = value as HarmonyState;
  return validTonality(h.home) && validTonality(h.current) && typeof h.modulation === 'string' && Object.hasOwn(modulationNames, h.modulation)
    && (h.changedIn === undefined || typeof h.changedIn === 'string' && h.changedIn.length < 150);
}
export const makeHarmony = (home: Tonality = DEFAULT_TONALITY, modulation: Modulation = 'fixed'): HarmonyState => ({ home: { ...home }, current: { ...home }, modulation });
export const currentKey = (m: { harmony?: HarmonyState }): Tonality => m.harmony?.current ?? DEFAULT_TONALITY;
export const homeKey = (m: { harmony?: HarmonyState }): Tonality => m.harmony?.home ?? DEFAULT_TONALITY;
export const degreePitch = (base: number, degree: number, key: Tonality = DEFAULT_TONALITY) => base + key.tonic + modes[key.mode][(degree % 7 + 7) % 7] + 12 * Math.floor(degree / 7);
export function nearestDegree(midi: number, key: Tonality = DEFAULT_TONALITY): number {
  const pc = ((midi - key.tonic) % 12 + 12) % 12, scale = modes[key.mode];
  const distance = (n: number) => Math.min(Math.abs(n - pc), 12 - Math.abs(n - pc));
  return scale.reduce<number>((best, n, i) => distance(n) < distance(scale[best]) ? i : best, 0);
}
export function degreeName(degree: number, key: Tonality = DEFAULT_TONALITY): string {
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], naturals = [0, 2, 4, 5, 7, 9, 11];
  const index = (letters.indexOf(tonicNames[key.tonic][0]) + (degree % 7 + 7) % 7) % 7;
  const pc = (degreePitch(0, degree, key) % 12 + 12) % 12;
  const accidental = ((pc - naturals[index] + 18) % 12) - 6;
  return letters[index] + (accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental));
}
export function relatedKey(home: Tonality, change: Exclude<KeyChange, 'stay'>): Tonality {
  if (change === 'home') return { ...home };
  if (change === 'dominant' || change === 'subdominant') return { ...home, tonic: (home.tonic + (change === 'dominant' ? 7 : 5)) % 12 };
  if (change === 'parallel') return { tonic: home.tonic, mode: modes[home.mode][2] === 4 ? 'minor' : 'major' };
  if (home.mode === 'major') return { tonic: (home.tonic + 9) % 12, mode: 'minor' };
  const offsets = { minor: 3, harmonicMinor: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5, locrian: 1 };
  return { tonic: (home.tonic + offsets[home.mode]) % 12, mode: 'major' };
}
export function sectionKey(home: Tonality, section: { form: string; theme: string; movement: number; index: number }): Tonality {
  if (section.form === 'classical') {
    if (section.movement === 2) return relatedKey(home, 'relative');
    if (section.movement === 3) return relatedKey(home, 'subdominant');
    if (section.movement === 1 && section.index >= 3) return { ...home }; // Recapitulation returns both themes home.
  }
  if (section.form === 'pop') return section.theme === 'C' ? relatedKey(home, 'relative') : { ...home };
  if (section.theme === 'B') return relatedKey(home, modes[home.mode][2] === 3 ? 'relative' : 'dominant');
  if (section.theme === 'C' || section.theme === 'D') return relatedKey(home, 'relative');
  return { ...home };
}
export function randomTonality(previous?: Tonality): Tonality {
  const choices: Mode[] = ['major', 'minor', 'dorian', 'mixolydian'];
  const key = { tonic: Math.floor(Math.random() * 12), mode: choices[Math.floor(Math.random() * choices.length)] };
  if (previous && sameKey(previous, key)) key.tonic = (key.tonic + 1) % 12;
  return key;
}
