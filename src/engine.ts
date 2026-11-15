import { orchestra, isPitched, type Instrument } from './orchestra';
import { validDecision, validStartingMotif, type MelodyDecision, type StartingMotif } from './melody';
import { formPosition, makeForm, validForm, type FormSettings, type FormState } from './forms';
import { currentKey, homeKey, DEFAULT_TONALITY, degreePitch, nearestDegree, makeHarmony, validHarmony, sameKey, sectionKey, relatedKey, keyChanges, type HarmonyState, type KeyChange, type Modulation, type Tonality } from './tonality';
export { instruments } from './orchestra';
import { articulations, noteValues, normalizeRhythm, onsetGap, soundingDuration, validPhrasing, avoidRhythmicRepeat, type Articulation, type NoteValue, type Phrasing } from './phrasing';
import { SampleBank, type SampleProgress } from './sample-bank';
import { harmonicMotion, voiceChord } from './harmonic-motion';
import { ensembleRhythm } from './ensemble-rhythm';
import { avoidMelodicRepeat } from './melodic-variation';
import { composeEnsemble, ensemblePhrasing, evolveEnsemble, enableEnsemble, rememberEnsemble, validEnsemble, type EnsembleState } from './ensemble';

export type PlayedNote = NoteEvent & { step: number };
export type Musician = Phrasing & {
  id: string; instrument: number; tempo: number; energy: number; motif: number[]; beat: number; group: number;
  rhythm: number[]; recentNotes: PlayedNote[]; audible: boolean;
  seeded?: boolean;
  form?: FormState;
  harmony?: HarmonyState;
  decision?: MelodyDecision & { appliedAt: number };
  ensemble?: EnsembleState;
};
export function createMusician(instrument: number, id = String(instrument)): Musician {
  if (!orchestra[instrument] || !Number.isInteger(instrument)) throw new RangeError('Unknown orchestral instrument');
  return { id, instrument, tempo: 112, energy: .45, motif: [0, 2, 4, 2], beat: 0, group: instrument % 2, rhythm: [...orchestra[instrument].pattern], recentNotes: [], audible: true };
}
export const createOrchestra = (): Musician[] => orchestra.map((_, i) => createMusician(i));

export const isOpening = (m: Musician) => m.seeded === true && m.beat < 32;
export const isFormEntrance = (m: Musician) => !!m.form && ((m.form.enteredAt !== undefined && m.beat < m.form.enteredAt + 16) || (!!m.form.selected && m.beat < m.form.startBeat));
export const musicianPhrasing = (m: Musician) => m.ensemble && !isOpening(m) ? ensemblePhrasing(m) : normalizeRhythm(m, isOpening(m) ? 'plain' : m.form?.expression && m.form.expression !== 'auto' ? m.form.expression : m.decision?.gesture ?? m.form?.gesture);
export function harmonyWindow(m: Musician): string {
  const position = formPosition(m.form, m.beat);
  return position.form !== 'free' && !position.waiting ? position.token : `phrase:${Math.floor(m.beat / 64)}`;
}
export function allowedKeyChanges(m: Musician): readonly KeyChange[] {
  if (m.ensemble && m.ensemble.mode !== 'unified') return ['stay'];
  if (m.harmony?.modulation !== 'agent' || !isPitched(m.instrument) || isOpening(m) || isFormEntrance(m)
    || formPosition(m.form, m.beat).returning || m.harmony.changedIn === harmonyWindow(m)) return ['stay'];
  return keyChanges;
}
export function decisionKey(m: Musician, change: KeyChange = 'stay'): Tonality {
  return change === 'stay' ? currentKey(m) : relatedKey(homeKey(m), change);
}
export function configureHarmony(m: Musician, home: Tonality, modulation: Modulation): Musician {
  const harmony = makeHarmony(home, modulation);
  if (!validHarmony(harmony)) throw new Error('Invalid key, mode or modulation policy.');
  const updated = { ...m, harmony, decision: undefined, recentNotes: [] };
  return m.form ? configureForm(updated, m.form) : updated;
}
export function configureForm(m: Musician, settings: FormSettings): Musician {
  return { ...m, decision: undefined, form: makeForm(settings, { motif: m.motif, ...musicianPhrasing(m), energy: m.energy, tonality: { ...currentKey(m) } }, isOpening(m) ? 32 : Math.ceil(m.beat / 16) * 16) };
}
export function advanceForm(m: Musician): Musician {
  if (m.ensemble && m.ensemble.mode !== 'unified') return m;
  if (!m.form || m.beat % 16 !== 0) return m;
  const position = formPosition(m.form, m.beat);
  if (position.waiting || position.form === 'free' || m.form.token === position.token) return m;
  const remembered = m.form.themes[position.themeKey];
  const home = m.form.home;
  const shift = position.theme === 'B' ? 2 : position.theme === 'C' ? 4 : 1;
  const motif = position.theme === 'A' || position.theme === 'I' ? [...home.motif]
    : [...home.motif].reverse().map(n => (n + shift) % 7);
  const rhythm = position.theme === 'I' ? home.rhythm.filter((_, i) => i % 2 === 0) : [...home.rhythm];
  const tonality = m.harmony?.modulation === 'form' ? sectionKey(homeKey(m), position)
    : m.harmony?.modulation === 'agent' ? remembered?.tonality ?? currentKey(m) : homeKey(m);
  const initialPhrasing = position.theme === 'A' ? normalizeRhythm(home) : normalizeRhythm({ rhythm });
  const theme = remembered ?? { motif, ...initialPhrasing, energy: position.energy, tonality: { ...tonality } };
  return rememberEnsemble({ ...m, motif: [...theme.motif], ...normalizeRhythm(theme), energy: position.energy, decision: undefined, seeded: undefined,
    harmony: m.harmony ? { ...m.harmony, current: { ...tonality }, changedIn: undefined } : undefined,
    form: { ...m.form, token: position.token, enteredAt: m.beat, gesture: m.form.expression && m.form.expression !== 'auto' ? m.form.expression : position.gesture,
      themes: { ...m.form.themes, [position.themeKey]: structuredClone(theme) } } });
}
export function seedMusician(m: Musician, phrase: StartingMotif | null): Musician {
  if (phrase && !validStartingMotif(phrase)) throw new Error('Invalid starting motif.');
  const fresh = createMusician(m.instrument, m.id);
  const seeded = { ...fresh, group: m.group, audible: m.audible,
    harmony: m.harmony || phrase?.tonality ? makeHarmony(phrase?.tonality ?? homeKey(m), m.harmony?.modulation ?? 'fixed') : undefined, ...(phrase ? {
    motif: [...phrase.motif], ...normalizeRhythm(isPitched(m.instrument) ? phrase : fresh), seeded: true,
  } : {}) };
  const result = m.form ? configureForm(seeded, m.form) : seeded;
  return m.ensemble ? enableEnsemble(result) : result;
}

function advanceRhythm(m: Musician, peers: Musician[]): Musician {
  if (m.beat % 16 !== 0 || isOpening(m) || isFormEntrance(m) || m.decision?.themeAction === 'recall') return m;
  const age = m.beat - (m.decision?.appliedAt ?? m.form?.enteredAt ?? 0);
  const gesture = m.form?.expression && m.form.expression !== 'auto' ? m.form.expression : m.decision?.gesture ?? m.form?.gesture;
  // Let the phrase establish itself for two bars; hooks get four. The same
  // development runs during inference delays and with the LLM disabled.
  const interval = gesture === 'ostinato' ? 64 : 32;
  if (age < interval || age % interval !== 0) return m;
  if (!m.decision) return { ...m, ...ensembleRhythm(m, peers, gesture) };
  const recent = [m.rhythm, ...(m.decision ? [m.decision.rhythm] : [])];
  return { ...m, ...avoidRhythmicRepeat(m, recent, m.instrument + Math.floor(m.beat / 16), gesture) };
}

export function evolve(self: Musician, peers: Musician[]): Musician {
  if (self.ensemble) return evolveEnsemble(self);
  const valid = peers.filter(p => p.id !== self.id).sort((a, b) => a.id.localeCompare(b.id));
  const peerTempo = valid.length ? valid.reduce((s, p) => s + p.tempo, 0) / valid.length : 112;
  const position = formPosition(self.form, self.beat);
  const structured = self.form && !position.waiting && position.form !== 'free';
  const target = structured ? position.tempo * .85 + peerTempo * .15 : peerTempo;
  const sounding = valid.filter(p => p.audible && p.recentNotes.some(n => n.step >= p.beat - 32));
  const energy = sounding.length ? sounding.reduce((s, p) => s + p.energy, 0) / sounding.length : self.energy;
  const bar = Math.floor(self.beat / 16);
  // Shared intentions temper local exploration; isolated branches develop more freely.
  const exploration = valid.some(p => p.group !== self.group) ? .15 : 1;
  const drift = Math.sin(bar * .7 + self.group * 2.6) * .35 * exploration;
  // A model's pitches remain intact; held rhythms develop at later bar boundaries.
  // Without inference, the rule fallback still listens to performed notes once per bar.
  const heard = sounding.filter(p => isPitched(p.instrument)).flatMap(p => p.recentNotes.filter(n => n.step >= p.beat - 32));
  const degrees = heard.map(n => nearestDegree(n.midi, currentKey(self)));
  // Even a solo instrument can develop its own contour. Perform this before
  // the next bar sounds; accepted LLM pitches and remembered themes stay intact.
  const next = { ...self, tempo: Math.max(70, Math.min(150, self.tempo + (target - self.tempo) * .12 + drift)), energy: Math.max(.2, Math.min(.9, self.energy + (energy - self.energy) * .1 + drift * .015 + (structured ? (position.energy - self.energy) * .025 : 0))), beat: self.beat + 1 };
  if (!next.decision && !isOpening(next) && !isFormEntrance(next) && next.beat % 16 === 0 && degrees.length) {
    next.motif = Array.from({ length: 8 }, (_, i) => i % 2 === 0
      ? self.motif[(i / 2) % self.motif.length]
      : degrees[(self.instrument * 3 + Math.floor(next.beat / 16) + i) % degrees.length]);
  }
  if (!next.decision && isPitched(next.instrument) && !isOpening(next) && !isFormEntrance(next) && next.beat % 32 === 0) {
    next.motif = avoidMelodicRepeat(next.motif, [self.motif], next.rhythm.length, next.instrument + Math.floor(next.beat / 16));
  }
  return advanceRhythm(next, valid);
}
export function validState(p: unknown): p is Musician {
  if (!p || typeof p !== 'object') return false;
  const s = p as Musician;
  return typeof s.id === 'string' && s.id.length > 0 && s.id.length < 100 && Number.isInteger(s.instrument) && s.instrument >= 0 && s.instrument < orchestra.length && Number.isFinite(s.tempo) && s.tempo >= 60 && s.tempo <= (s.ensemble ? 220 : 180) && Number.isFinite(s.energy) && s.energy >= 0 && s.energy <= 1 && Number.isSafeInteger(s.beat) && s.beat >= 0 && Number.isInteger(s.group) && s.group >= 0 && s.group < orchestra.length && Array.isArray(s.motif) && s.motif.length > 0 && s.motif.length <= 16 && s.motif.every(n => Number.isInteger(n) && n >= 0 && n < 7)
    && typeof s.audible === 'boolean' && Array.isArray(s.rhythm) && s.rhythm.length > 0 && s.rhythm.length <= 16 && new Set(s.rhythm).size === s.rhythm.length && s.rhythm.every(n => Number.isInteger(n) && n >= 0 && n < 16)
    && validPhrasing(s, s.rhythm.length)
    && Array.isArray(s.recentNotes) && s.recentNotes.length <= 24 && s.recentNotes.every(n => n && Number.isSafeInteger(n.step) && n.step >= 0 && n.step <= s.beat && Number.isInteger(n.midi) && n.midi >= 12 && n.midi <= 120 && Number.isFinite(n.duration) && n.duration > 0 && n.duration <= 5 && Number.isFinite(n.velocity) && n.velocity >= 0 && n.velocity <= 1)
    && (s.ensemble === undefined || validEnsemble(s.ensemble))
    && (s.seeded === undefined || typeof s.seeded === 'boolean')
    && s.recentNotes.every(n => n.offset === undefined || Number.isFinite(n.offset) && n.offset >= 0 && n.offset <= 4)
    && s.recentNotes.every(n => (n.noteValue === undefined || noteValues.includes(n.noteValue)) && (n.articulation === undefined || articulations.includes(n.articulation)))
    && (s.form === undefined || validForm(s.form, s.beat))
    && (s.harmony === undefined || validHarmony(s.harmony))
    && (s.decision === undefined || (validDecision(s.decision) && Number.isSafeInteger(s.decision.appliedAt) && s.decision.appliedAt >= 0 && s.decision.appliedAt <= s.beat));
}

export type NoteEvent = { midi: number; duration: number; velocity: number; offset?: number; noteValue?: NoteValue; articulation?: Articulation };

// Each agent derives notes from its own history, harmonic role and received energy.
export function compose(m: Musician): NoteEvent[] {
  if (m.ensemble && !(m.ensemble.mode === 'unified' && isOpening(m))) return composeEnsemble(m);
  const profile = orchestra[m.instrument];
  const key = isPitched(m.instrument) ? currentKey(m) : DEFAULT_TONALITY;
  const pitch = (base: number, degree: number) => degreePitch(base, degree, key);
  const step = m.beat % 16;
  const planned = !!m.decision || m.seeded === true || m.form?.enteredAt !== undefined;
  if (!m.rhythm.includes(step)) return [];
  if (!m.decision && profile.voice === 'cymbal' && Math.floor(m.beat / 16) % 4 !== 0) return [];
  const phrasePosition = Math.floor((m.beat - (m.decision?.appliedAt ?? m.form?.enteredAt ?? 0)) / 16) * m.rhythm.length + Math.max(0, m.rhythm.indexOf(step));
  const gesture = isPitched(m.instrument) && !isOpening(m) ? m.decision?.gesture ?? m.form?.gesture ?? 'plain' : 'plain';
  const cellLength = gesture === 'ostinato' ? Math.min(4, m.motif.length) : m.motif.length;
  const degree = m.motif[(planned ? phrasePosition : Math.floor(m.beat / 2) + m.instrument) % cellLength];
  const root = m.motif[0];
  let selected = !planned && profile.base <= 36 ? root : degree;
  const preserveTheme = isOpening(m) || isFormEntrance(m) || m.decision?.themeAction === 'recall';
  const accompaniment = isPitched(m.instrument) && !preserveTheme && (profile.base <= 36 || profile.name === 'Piano');
  const chord = harmonicMotion(m);
  if (accompaniment) selected = profile.name === 'Piano' || step % 8 === 0 ? chord.root : (chord.root + 4) % 7;
  const position = formPosition(m.form, m.beat);
  if (m.form && !position.waiting && position.cadence && step === m.rhythm.at(-1)) selected = 0;
  const unit = 60 / m.tempo / 4;
  const phrasing = musicianPhrasing(m), onset = phrasing.rhythm.indexOf(step);
  const noteValue = onset >= 0 ? phrasing.durations[onset] : 1;
  const articulation = onset >= 0 ? phrasing.articulations[onset] : 'normal';
  const gapToNext = onset >= 0 ? onsetGap(phrasing.rhythm, onset) : 1;
  // No slur through a written rest or the end of a bar; new phrases may enter there.
  const duration = soundingDuration(noteValue, gapToNext, m.tempo, articulation, step + gapToNext < 16);
  const ghost = !m.decision && !preserveTheme && profile.voice === 'snare' && step !== 4 && step !== 12;
  const velocity = Math.min(1, m.energy * (articulation === 'accent' ? 1.18 : 1)) * (ghost ? .45 : 1);
  const lastStep = m.recentNotes.filter(n => n.step < m.beat && n.step >= m.beat - 32).at(-1)?.step;
  const voicing = accompaniment && profile.name === 'Piano'
    ? voiceChord(profile.base, chord.degrees, key, m.recentNotes.filter(n => n.step === lastStep).map(n => n.midi)) : undefined;
  if (gesture === 'arpeggio' || gesture === 'mordent' || gesture === 'trill') {
    const figure = gesture === 'arpeggio' && accompaniment ? chord.degrees.slice(0, 3)
      : gesture === 'arpeggio' ? [selected, selected + 2, selected + 4] : gesture === 'mordent' ? [selected, selected - 1, selected] : [selected, selected + 1, selected, selected + 1];
    const span = gesture === 'arpeggio' ? noteValue * unit : Math.min(unit, duration);
    const gap = span / figure.length;
    return figure.map((n, i) => ({ midi: gesture === 'arpeggio' && voicing ? voicing[i] : pitch(profile.base, n), offset: i * gap,
      duration: gesture === 'arpeggio' ? soundingDuration(noteValue / figure.length, noteValue / figure.length, m.tempo, articulation, i < figure.length - 1)
        : i === figure.length - 1 ? Math.max(gap * .4, duration - i * gap) : gap * (articulation === 'staccato' ? .4 : articulation === 'legato' ? 1.02 : .9),
      velocity: velocity * (i ? .72 : 1) / Math.sqrt(figure.length), noteValue, articulation }));
  }
  const degrees = profile.name === 'Piano' ? [selected, selected + 2, selected + 4] : [selected];
  const pitches = voicing ?? degrees.map(n => pitch(profile.base, n));
  return pitches.map(midi => ({ midi, duration, velocity: velocity / Math.sqrt(pitches.length), noteValue, articulation }));
}

// Record only notes that the scheduler actually sends to the local audio engine.
export function recordPerformance(m: Musician, notes: NoteEvent[], audible: boolean): Musician {
  const recent = m.recentNotes.filter(n => n.step >= m.beat - 32);
  const played = audible ? notes.map(n => ({ ...n, step: m.beat })) : [];
  return { ...m, audible, recentNotes: [...recent, ...played].slice(-24) };
}

export function applyDecision(m: Musician, decision: MelodyDecision): Musician {
  if (m.ensemble?.mode === 'bridging') return m;
  if (isOpening(m) || isFormEntrance(m) || m.beat % 16 !== 0 || !validDecision(decision)) return m;
  if (!allowedKeyChanges(m).includes(decision.keyChange ?? 'stay')) return m;
  if (decision.tonality && !sameKey(decision.tonality, decisionKey(m, decision.keyChange))) return m;
  const plan = structuredClone(decision);
  Object.assign(plan, normalizeRhythm(plan));
  const form = m.form?.choice === 'auto' && !m.form.selected && plan.form
    ? { ...m.form, selected: plan.form, startBeat: m.beat + 16 } : m.form;
  const key = decisionKey(m, plan.keyChange);
  const harmony = m.harmony && !sameKey(currentKey(m), key) ? { ...m.harmony, current: { ...key }, changedIn: harmonyWindow(m) } : m.harmony;
  return rememberEnsemble({ ...m, form, harmony, seeded: undefined, motif: [...plan.motif], ...normalizeRhythm(plan), energy: plan.energy, decision: { ...plan, appliedAt: m.beat } });
}

export class AudioEngine {
  context: AudioContext;
  master: GainNode;
  private buses: GainNode[];
  private noise: AudioBuffer;
  private samples: SampleBank;
  constructor() {
    this.context = new AudioContext();
    this.samples = new SampleBank(this.context);
    this.master = this.context.createGain();
    this.master.gain.value = .35;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 15;
    compressor.ratio.value = 6;
    this.master.connect(compressor);
    compressor.connect(this.context.destination);
    this.buses = orchestra.map(profile => {
      const gain = this.context.createGain(), pan = this.context.createStereoPanner();
      pan.pan.value = profile.pan;
      gain.connect(pan); pan.connect(this.master);
      return gain;
    });
    this.noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 17;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = seed / 2147483648;
    }
  }
  async resume() { await this.context.resume(); }
  prepare(instruments: readonly number[] = orchestra.map((_, i) => i), progress?: (value: SampleProgress) => void) {
    return this.samples.load(instruments, progress);
  }
  setMuted(instrument: number, muted: boolean) {
    this.buses[instrument].gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, .015);
  }
  note(m: Musician, time: number, notes = compose(m)) {
    const profile = orchestra[m.instrument];
    for (const note of notes) this.play(profile, m.instrument, note, time + (note.offset ?? 0));
  }
  private play(profile: Instrument, instrument: number, note: NoteEvent, time: number) {
    if (this.samples.play(instrument, note, time, this.buses[instrument], profile.level)) return;
    const gain = this.context.createGain();
    gain.connect(this.buses[instrument]);
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const end = time + note.duration;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(profile.level * note.velocity, time + Math.min(profile.attack, note.duration / 3));
    if (['bowed', 'air', 'reed', 'brass'].includes(profile.voice)) {
      const release = Math.min(.06, note.duration * .2);
      gain.gain.linearRampToValueAtTime(profile.level * note.velocity * .8, end - release);
    }
    gain.gain.exponentialRampToValueAtTime(.00001, end);
    if (profile.voice === 'snare' || profile.voice === 'cymbal') {
      const noise = this.context.createBufferSource(), filter = this.context.createBiquadFilter();
      noise.buffer = this.noise; noise.loop = true;
      filter.type = 'highpass'; filter.frequency.value = profile.voice === 'snare' ? 1300 : 6000;
      noise.connect(filter); filter.connect(gain);
      noise.start(time); noise.stop(end + .01);
      noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
      return;
    }
    const osc = this.context.createOscillator(), filter = this.context.createBiquadFilter();
    const voice = profile.voice;
    osc.type = voice === 'bowed' || voice === 'brass' ? 'sawtooth' : voice === 'reed' ? 'square' : voice === 'pluck' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(voice === 'kick' ? 95 : frequency, time);
    if (voice === 'kick' || voice === 'timpani') osc.frequency.exponentialRampToValueAtTime(voice === 'kick' ? 32 : frequency * .96, time + .14);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(18000, frequency * (voice === 'brass' ? 6 : voice === 'reed' ? 4 : 3)), time);
    filter.Q.value = .7;
    osc.connect(filter); filter.connect(gain);
    osc.start(time); osc.stop(end + .01);
    // Inharmonic partial gives tuned percussion a bell-like attack.
    let partial: OscillatorNode | undefined, partialGain: GainNode | undefined;
    if (voice === 'bell' || voice === 'triangle') {
      partial = this.context.createOscillator(); partialGain = this.context.createGain();
      partial.frequency.value = frequency * (voice === 'triangle' ? 1.48 : 2.76);
      partialGain.gain.value = .22;
      partial.connect(partialGain); partialGain.connect(gain);
      partial.start(time); partial.stop(end + .01);
    }
    osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); partial?.disconnect(); partialGain?.disconnect(); };
  }
  close() { this.samples.close(); if (this.context.state !== 'closed') void this.context.close(); }
}
