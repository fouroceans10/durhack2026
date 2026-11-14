export const sections = ['Strings', 'Woodwinds', 'Brass', 'Percussion', 'Harp & keyboards'] as const;
export type Section = typeof sections[number];
export type Voice = 'bowed' | 'air' | 'reed' | 'brass' | 'pluck' | 'bell' | 'timpani' | 'snare' | 'kick' | 'cymbal' | 'triangle';
export type Instrument = {
  name: string;
  section: Section;
  role: string;
  voice: Voice;
  base: number;
  pattern: readonly number[];
  duration: number;
  attack: number;
  level: number;
  pan: number;
};

// One catalog entry = one autonomous agent. MIDI bases establish independent registers;
// patterns describe sixteenth-note entrances within a bar, not prerecorded phrases.
export const orchestra: readonly Instrument[] = [
  { name: 'Violin', section: 'Strings', role: 'Singing melody', voice: 'bowed', base: 72, pattern: [0, 2, 4, 6, 8, 10, 12, 14], duration: .36, attack: .04, level: .055, pan: -.7 },
  { name: 'Viola', section: 'Strings', role: 'Inner counterpoint', voice: 'bowed', base: 60, pattern: [2, 6, 10, 14], duration: .55, attack: .06, level: .05, pan: -.3 },
  { name: 'Cello', section: 'Strings', role: 'Lyrical foundation', voice: 'bowed', base: 48, pattern: [0, 4, 8, 12], duration: .7, attack: .07, level: .065, pan: .3 },
  { name: 'Double bass', section: 'Strings', role: 'Harmonic anchor', voice: 'bowed', base: 36, pattern: [0, 8], duration: .9, attack: .08, level: .08, pan: .65 },
  { name: 'Piccolo', section: 'Woodwinds', role: 'High accents', voice: 'air', base: 84, pattern: [6, 14], duration: .2, attack: .025, level: .025, pan: -.5 },
  { name: 'Flute', section: 'Woodwinds', role: 'Airborne phrases', voice: 'air', base: 72, pattern: [0, 3, 8, 11], duration: .45, attack: .05, level: .05, pan: -.35 },
  { name: 'Oboe', section: 'Woodwinds', role: 'Expressive replies', voice: 'reed', base: 72, pattern: [2, 6, 10], duration: .5, attack: .04, level: .04, pan: -.1 },
  { name: 'English horn', section: 'Woodwinds', role: 'Warm countermelody', voice: 'reed', base: 60, pattern: [4, 12], duration: .85, attack: .07, level: .045, pan: .1 },
  { name: 'Clarinet', section: 'Woodwinds', role: 'Flowing variations', voice: 'reed', base: 60, pattern: [0, 3, 6, 10, 14], duration: .4, attack: .035, level: .045, pan: -.25 },
  { name: 'Bass clarinet', section: 'Woodwinds', role: 'Dark responses', voice: 'reed', base: 48, pattern: [2, 10], duration: .7, attack: .06, level: .05, pan: .2 },
  { name: 'Bassoon', section: 'Woodwinds', role: 'Playful bass line', voice: 'reed', base: 48, pattern: [0, 6, 8, 14], duration: .35, attack: .03, level: .055, pan: .4 },
  { name: 'Contrabassoon', section: 'Woodwinds', role: 'Deep reinforcement', voice: 'reed', base: 24, pattern: [0, 8], duration: .8, attack: .08, level: .07, pan: .55 },
  { name: 'French horn', section: 'Brass', role: 'Rounded harmony', voice: 'brass', base: 48, pattern: [0, 8], duration: 1.05, attack: .12, level: .06, pan: -.5 },
  { name: 'Trumpet', section: 'Brass', role: 'Bright calls', voice: 'brass', base: 72, pattern: [0, 6, 12], duration: .32, attack: .025, level: .04, pan: -.15 },
  { name: 'Trombone', section: 'Brass', role: 'Harmonic pillars', voice: 'brass', base: 48, pattern: [4, 12], duration: .7, attack: .07, level: .06, pan: .2 },
  { name: 'Bass trombone', section: 'Brass', role: 'Low brass weight', voice: 'brass', base: 36, pattern: [4, 12], duration: .8, attack: .08, level: .06, pan: .4 },
  { name: 'Tuba', section: 'Brass', role: 'Resonant roots', voice: 'brass', base: 36, pattern: [0, 8], duration: 1.1, attack: .1, level: .075, pan: .65 },
  { name: 'Timpani', section: 'Percussion', role: 'Tuned punctuation', voice: 'timpani', base: 36, pattern: [0, 8, 14], duration: .7, attack: .005, level: .12, pan: -.45 },
  { name: 'Snare drum', section: 'Percussion', role: 'Rhythmic detail', voice: 'snare', base: 48, pattern: [4, 12], duration: .18, attack: .003, level: .065, pan: -.2 },
  { name: 'Bass drum', section: 'Percussion', role: 'The deep pulse', voice: 'kick', base: 24, pattern: [0, 8], duration: .35, attack: .004, level: .14, pan: 0 },
  { name: 'Cymbals', section: 'Percussion', role: 'Transition shimmer', voice: 'cymbal', base: 84, pattern: [0], duration: 1.5, attack: .005, level: .025, pan: .25 },
  { name: 'Triangle', section: 'Percussion', role: 'Delicate sparks', voice: 'triangle', base: 96, pattern: [6, 14], duration: .8, attack: .003, level: .025, pan: .5 },
  { name: 'Glockenspiel', section: 'Percussion', role: 'Crystalline melody', voice: 'bell', base: 84, pattern: [2, 10], duration: .9, attack: .003, level: .025, pan: .7 },
  { name: 'Harp', section: 'Harp & keyboards', role: 'Broken-chord ripples', voice: 'pluck', base: 60, pattern: [0, 2, 4, 6, 8, 10, 12, 14], duration: .7, attack: .004, level: .055, pan: -.65 },
  { name: 'Piano', section: 'Harp & keyboards', role: 'Harmonic architecture', voice: 'pluck', base: 48, pattern: [0, 8], duration: 1.1, attack: .005, level: .06, pan: .1 },
  { name: 'Celesta', section: 'Harp & keyboards', role: 'Soft bell echoes', voice: 'bell', base: 72, pattern: [4, 12], duration: .9, attack: .006, level: .035, pan: .4 },
];
export const sectionColors: Record<Section, string> = {
  Strings: 'var(--strings)', Woodwinds: 'var(--woodwinds)', Brass: 'var(--brass)', Percussion: 'var(--percussion)', 'Harp & keyboards': 'var(--keys)',
};
export const instruments = orchestra.map(instrument => instrument.name);

export const isPitched = (instrument: number) => !['snare', 'kick', 'cymbal', 'triangle'].includes(orchestra[instrument].voice);
