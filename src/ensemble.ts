import type { Musician, NoteEvent } from './engine';
import { orchestra } from './orchestra';
import { musicRole } from './music-roles';
import { currentKey, degreePitch, makeHarmony, modes, type Tonality } from './tonality';
import { normalizeRhythm, soundingDuration, onsetGap, type Articulation } from './phrasing';
import { canExchange, partitionGroup, type PartitionPlan } from './partitions';
import { generateDeterministicMotif } from './music-core/motif';
import { semitoneToPitchClass, pitchClassToSemitone } from './music-core/circleOfFifths';
import { getDiatonicProgression, parseChordSymbol } from './music-core/musicTheory';
import { computeReconcilePlan, interpolateBridgeState } from './music-core/reconciliation';
import type { IntentPacket, MotifRecord, MusicalMode, NetworkMode, ReconcilePlan } from './music-core/types';

export type EnsembleState = {
  mode: NetworkMode; tension: number; drumsEnergy: number; pianoTension: number;
  motif: MotifRecord; history: MotifRecord[];
  partitionId?: string;
  baseline?: { tempo: number; key: Tonality }; hasDrums: boolean;
  bridge?: { plan: ReconcilePlan; step: number; tempo: number; tension: number; chord: string };
};
const coreMode = (m: Musician): MusicalMode => {
  const mode = currentKey(m).mode;
  return mode === 'dorian' ? mode : modes[mode][2] === 3 ? 'minor' : 'major';
};
const keyRoot = (m: Musician) => semitoneToPitchClass(currentKey(m).tonic);
const withKey = (m: Musician, key: Tonality): Musician => ({ ...m, harmony: { ...(m.harmony ?? makeHarmony(key)), current: key } });
function motifFor(m: Musician, hasDrums: boolean, mode: NetworkMode, sequence = 0) {
  const motif = generateDeterministicMotif({ role: musicRole(m.instrument), partitionGroupId: m.ensemble?.partitionId ?? String(m.group), modeState: mode,
    bpm: m.tempo, keyRoot: keyRoot(m), mode: coreMode(m), energy: m.energy, tension: m.ensemble?.tension ?? .25,
    barNumber: Math.floor(m.beat / 16), hasDrumsInGroup: hasDrums }, sequence);
  return { ...motif, id: `${m.id}:${motif.id}` };
}
export function enableEnsemble(m: Musician): Musician {
  if (m.ensemble) return m;
  m = { ...m, tempo: 120, energy: .6 };
  return { ...m, ensemble: { mode: 'unified', tension: .25, drumsEnergy: .6, pianoTension: .25,
    motif: motifFor(m, true, 'unified'), history: [], hasDrums: true } };
}
export function rememberEnsemble(m: Musician): Musician {
  if (!m.ensemble) return m;
  const motif: MotifRecord = { ...motifFor(m, m.ensemble.hasDrums, m.ensemble.mode), id: `${m.id}:phrase:${m.beat}`,
    scaleDegrees: [...m.motif], rhythmSteps: [...m.rhythm] };
  return { ...m, ensemble: { ...m.ensemble, motif, tension: musicRole(m.instrument) === 'piano' ? m.energy : m.ensemble.tension,
    history: m.ensemble.mode === 'partitioned' ? [...m.ensemble.history, motif].slice(-8) : m.ensemble.history } };
}

export function validEnsemble(value: EnsembleState): boolean {
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  const bpm = (n: number) => Number.isFinite(n) && n >= 40 && n <= 240;
  const key = (k: string) => typeof k === 'string' && /^[A-G][#b]?$/.test(k);
  const mode = (m: string) => ['major', 'minor', 'dorian'].includes(m);
  const motif = (m: MotifRecord) => !!m && typeof m.id === 'string' && m.id.length <= 250
    && ['drums', 'bass', 'piano', 'lead'].includes(m.authorRole) && typeof m.createdDuringPartitionId === 'string' && m.createdDuringPartitionId.length < 150
    && key(m.keyRoot) && mode(m.mode) && bpm(m.bpm)
    && Array.isArray(m.scaleDegrees) && m.scaleDegrees.length > 0 && m.scaleDegrees.length <= 16 && m.scaleDegrees.every(d => Number.isInteger(d) && d >= -7 && d <= 21)
    && Array.isArray(m.rhythmSteps) && m.rhythmSteps.length > 0 && m.rhythmSteps.length <= 16 && m.rhythmSteps.every(d => Number.isInteger(d) && d >= 0 && d < 16);
  if (!value || !['unified', 'partitioned', 'bridging'].includes(value.mode) || !unit(value.tension) || !unit(value.drumsEnergy) || !unit(value.pianoTension)
    || typeof value.hasDrums !== 'boolean' || !motif(value.motif) || !Array.isArray(value.history) || value.history.length > 8 || !value.history.every(motif)) return false;
  if (value.partitionId !== undefined && (typeof value.partitionId !== 'string' || value.partitionId.length > 150)) return false;
  if (value.baseline && (!bpm(value.baseline.tempo) || !value.baseline.key || !Number.isInteger(value.baseline.key.tonic) || value.baseline.key.tonic < 0 || value.baseline.key.tonic > 11 || !Object.hasOwn(modes, value.baseline.key.mode))) return false;
  if (value.bridge) {
    const b = value.bridge, p = b.plan;
    if (!p || !bpm(b.tempo) || !unit(b.tension) || !Number.isInteger(b.step) || b.step < 0 || b.step > 64
      || !bpm(p.targetBpm) || !key(p.targetKeyRoot) || !mode(p.targetMode) || p.bridgeBars !== 4 || !Number.isFinite(p.bridgeStartEpochMs)
      || !Array.isArray(p.adoptedMotifs) || p.adoptedMotifs.length > 576 || !p.adoptedMotifs.every(motif)
      || typeof b.chord !== 'string' || !/^[A-G][#b]?[a-zA-Z0-9]*$/.test(b.chord) || typeof p.pivotChord !== 'string' || !/^[A-G][#b]?[a-zA-Z0-9]*$/.test(p.pivotChord)) return false;
  }
  return value.mode !== 'bridging' || !!value.bridge;
}
export function ensembleIntent(m: Musician): IntentPacket {
  const s = enableEnsemble(m).ensemble!;
  // The audio scheduler advances a 64-step bridge. Its interpolation epoch is
  // relative to zero; it is not a claim of synchronized wall clocks across devices.
  return { peerId: m.id, role: musicRole(m.instrument), lamportClock: m.beat, partitionGroupId: s.partitionId ?? String(m.group), epochTimeMs: 0,
    barNumber: Math.floor(m.beat / 16), beatPhase: (m.beat % 16) / 4, bpm: m.tempo, keyRoot: keyRoot(m), mode: coreMode(m),
    chordSymbol: ensembleChord(m), energy: m.energy, tension: s.tension, activeMotif: s.motif, isolationMotifHistory: s.history, modeState: s.mode };
}
export function ensembleChord(m: Musician): string {
  return m.ensemble?.bridge?.chord ?? getDiatonicProgression(keyRoot(m), coreMode(m), m.ensemble?.pianoTension ?? .25)[Math.floor(m.beat / 16) % 4];
}

/** Apply the same snapshot and plan to every local player, before changing group IDs. */
export function partitionEnsemble(local: Musician[], plan: PartitionPlan | null, snapshot = local): Musician[] {
  const participants = snapshot.map(enableEnsemble);
  const healing = !plan && participants.some(m => m.ensemble!.mode === 'partitioned');
  const reconcile = healing ? computeReconcilePlan(participants.map(ensembleIntent)) : undefined;
  return local.map(original => {
    let m = enableEnsemble(original);
    const s = m.ensemble!;
    if (!plan) {
      if (!reconcile) return m;
      return { ...m, decision: undefined, ensemble: { ...s, mode: 'bridging', baseline: undefined,
        bridge: { plan: reconcile, step: 0, tempo: m.tempo, tension: s.tension, chord: reconcile.pivotChord } } };
    }
    const group = partitionGroup(plan, m.instrument);
    const members = participants.filter(p => p.id === m.id || canExchange(plan, m, p)).sort((a, b) => a.id.localeCompare(b.id));
    const leader = members[0] ?? m;
    const baseline = leader.ensemble?.baseline ?? { tempo: leader.tempo, key: currentKey(leader) };
    const hasDrums = [m, ...members].some(p => musicRole(p.instrument) === 'drums');
    const partitionId = plan.kind === 'solo' ? `solo:${m.id}` : String(group);
    m = withKey({ ...m, group, decision: undefined, seeded: undefined,
      ensemble: { ...s, partitionId },
      tempo: hasDrums ? Math.min(220, baseline.tempo + 8) : Math.max(60, baseline.tempo - 12),
      energy: hasDrums ? Math.min(1, m.energy + .15) : m.energy },
    { tonic: (baseline.key.tonic + (hasDrums ? 7 : 9)) % 12, mode: hasDrums ? 'major' : 'minor' });
    const motif = motifFor(m, hasDrums, 'partitioned', s.history.length + 1);
    return { ...m, ensemble: { ...s, partitionId, mode: 'partitioned', baseline, hasDrums, bridge: undefined,
      tension: hasDrums ? s.tension : Math.min(1, s.tension + .2), motif, history: [...s.history, motif].slice(-8) } };
  });
}

/** Called before sounding each step; peer influence never crosses the caller's partition. */
export function prepareEnsemble(m: Musician, peers: Musician[]): Musician {
  if (!m.ensemble) return m;
  let s = { ...m.ensemble };
  if (s.bridge) {
    const b = s.bridge, progress = (b.step + 1) / 64;
    const frame = interpolateBridgeState(b.tempo, b.tension, b.plan,
      b.plan.bridgeStartEpochMs + progress * 16 * 60000 / b.plan.targetBpm);
    m = { ...m, tempo: frame.bpm };
    s.tension = frame.tension;
    s.bridge = { ...b, step: b.step + 1, chord: b.step < 32 ? b.plan.pivotChord : frame.chordSymbol };
    if (b.step >= 32) {
      m = withKey(m, { tonic: pitchClassToSemitone(frame.keyRoot), mode: frame.mode });
      const adopted = b.plan.adoptedMotifs.find(motif => motif.authorRole !== musicRole(m.instrument));
      if (adopted) s.motif = { ...adopted, keyRoot: frame.keyRoot, mode: frame.mode, bpm: frame.bpm };
    }
    if (frame.isComplete) {
      s.mode = 'unified'; s.bridge = undefined;
      const adopted = b.plan.adoptedMotifs.find(motif => motif.authorRole === 'lead') ?? b.plan.adoptedMotifs[0];
      if (adopted) s.motif = { ...adopted, keyRoot: frame.keyRoot, mode: frame.mode, bpm: frame.bpm };
    }
  }
  const members = [m, ...peers].filter(p => p.audible).sort((a, b) => a.id.localeCompare(b.id));
  // One representative per role avoids 26 voices multiplying the feedback strength.
  const drums = members.find(p => p.instrument === 19) ?? members.find(p => musicRole(p.instrument) === 'drums');
  const piano = members.find(p => p.instrument === 24) ?? members.find(p => musicRole(p.instrument) === 'piano');
  s.drumsEnergy = drums?.energy ?? m.energy;
  s.pianoTension = s.mode === 'bridging' ? s.tension : piano?.ensemble?.tension ?? s.tension;
  return { ...m, ensemble: s };
}
export function evolveEnsemble(m: Musician): Musician {
  const next = { ...m, beat: m.beat + 1 };
  const s = m.ensemble!;
  if (next.beat % 16 === 0 && s.mode === 'partitioned' && s.baseline) {
    next.tempo = s.hasDrums ? Math.min(220, s.baseline.tempo + 12, m.tempo + 2) : Math.max(60, s.baseline.tempo - 14, m.tempo - 1);
  }
  return next;
}

/** Role rhythms and harmonic choices; sample timbres/registers remain orchestral. */
export function composeEnsemble(m: Musician): NoteEvent[] {
  const s = m.ensemble!, p = orchestra[m.instrument], role = musicRole(m.instrument), step = m.beat % 16;
  const energy = s.drumsEnergy, tension = s.pianoTension, unit = 60 / m.tempo / 4;
  const note = (midi: number, length: 1 | 2 | 4, velocity: number): NoteEvent => ({ midi, duration: length * unit, velocity, noteValue: length });
  if (role === 'drums') {
    if (p.voice === 'kick') return step === 0 || step === 8 || energy >= .45 && step === 10 || energy >= .75 && [3, 14].includes(step)
      ? [note(p.base, 2, Math.min(1, .75 + energy * .25))] : [];
    if (p.voice === 'snare') return [4, 12].includes(step) || energy >= .7 && [7, 15].includes(step)
      ? [note(p.base, 1, [7, 15].includes(step) ? .35 : Math.min(1, .7 + energy * .25))] : [];
    return step % 2 === 0 || energy >= .65 ? [note(p.base, tension >= .6 && step === 14 ? 4 : 1, step % 4 === 0 ? .65 : .4)] : [];
  }
  const chord = ensembleChord(m);
  if (role === 'bass') {
    const steps = energy >= .7 ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15] : energy >= .45 ? [0, 4, 6, 8, 12, 14] : [0, 4, 8, 12];
    if (!steps.includes(step)) return [];
    const pitches = parseChordSymbol(chord, Math.floor(p.base / 12) - 1).midiNotes;
    const pitch = step % 4 === 2 ? pitches[0] + 12 : step % 2 ? degreePitch(p.base, tension >= .6 ? 6 : 2, currentKey(m))
      : [4, 12].includes(step) ? pitches[2] : pitches[0];
    return [note(pitch, step % 2 ? 1 : 2, Math.min(1, .65 + energy * .3))];
  }
  if (role === 'piano') {
    if (!(energy >= .7 ? [0, 3, 6, 8, 11, 14] : [0, 8]).includes(step)) return [];
    const voiced = s.mode !== 'bridging' && tension >= .65 && !/7|9|sus/.test(chord) ? chord + (chord.endsWith('m') ? '9' : 'maj7') : chord;
    return parseChordSymbol(voiced, Math.floor(p.base / 12) - 1 + (energy >= .7 ? 1 : 0)).midiNotes
      .map(pitch => note(pitch, [0, 8].includes(step) ? 4 : 2, Math.min(1, .55 + energy * .3) / Math.sqrt(3)));
  }
  // Keep the existing LLM's full rhythm/duration/articulation plan for melodic roles.
  const formPhrase = m.form?.enteredAt !== undefined && s.motif.id === `${m.id}:phrase:${m.form.enteredAt}`;
  const planned = (!!m.decision || formPhrase && s.mode === 'unified') && s.mode !== 'bridging';
  const rhythm = planned ? m.rhythm : s.motif.rhythmSteps;
  const degrees = planned ? m.motif : s.motif.scaleDegrees;
  const index = rhythm.indexOf(step);
  if (index >= 0) {
    const gesture = m.form?.expression && m.form.expression !== 'auto' ? m.form.expression : m.decision?.gesture ?? m.form?.gesture ?? 'plain';
    const cellLength = planned && gesture === 'ostinato' ? Math.min(4, degrees.length) : degrees.length;
    const position = planned ? Math.floor((m.beat - (m.decision?.appliedAt ?? m.form?.enteredAt ?? 0)) / 16) * rhythm.length + index : index;
    const degree = degrees[((position % cellLength) + cellLength) % cellLength] + (tension >= .65 && step % 4 !== 0 ? 2 : 0);
    const event = note(degreePitch(p.base, degree, currentKey(m)), 2, Math.min(1, .65 + energy * .25));
    if (planned) {
      const phrase = normalizeRhythm(m, gesture), gap = onsetGap(rhythm, index);
      event.duration = soundingDuration(phrase.durations[index], gap, m.tempo, phrase.articulations[index], step + gap < 16);
      event.noteValue = phrase.durations[index]; event.articulation = phrase.articulations[index];
      if (event.articulation === 'accent') event.velocity = Math.min(1, event.velocity * 1.18);
      if (['arpeggio', 'mordent', 'trill'].includes(gesture)) {
        const figure = gesture === 'arpeggio' ? [degree, degree + 2, degree + 4]
          : gesture === 'mordent' ? [degree, degree - 1, degree] : [degree, degree + 1, degree, degree + 1];
        const span = gesture === 'arpeggio' ? event.noteValue * unit : Math.min(unit, event.duration), gap = span / figure.length;
        return figure.map((d, i) => ({ ...event, midi: degreePitch(p.base, d, currentKey(m)), offset: i * gap,
          duration: gesture === 'arpeggio' ? soundingDuration(event.noteValue! / figure.length, event.noteValue! / figure.length, m.tempo, event.articulation!, i < figure.length - 1)
            : i === figure.length - 1 ? Math.max(gap * .4, event.duration - i * gap) : gap * .9,
          velocity: event.velocity * (i ? .72 : 1) / Math.sqrt(figure.length) }));
      }
    }
    return [event];
  }
  return !planned && energy >= .7 && [3, 11].includes(step)
    ? [note(degreePitch(p.base + 12, tension >= .65 ? 6 : 4, currentKey(m)), 1, .6)] : [];
}

/** Display the role's actual entrances instead of a superseded model proposal. */
export function ensemblePhrasing(m: Musician) {
  const events = Array.from({ length: 16 }, (_, step) => ({ step, note: composeEnsemble({ ...m, beat: Math.floor(m.beat / 16) * 16 + step })[0] })).filter(e => !!e.note);
  return { rhythm: events.map(e => e.step), durations: events.map(e => e.note.noteValue ?? 2),
    articulations: events.map(e => e.note.articulation ?? 'normal' as Articulation) };
}
