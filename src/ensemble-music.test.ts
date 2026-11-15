import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceForm, applyDecision, compose, configureForm, configureHarmony, createMusician, evolve, recordPerformance, seedMusician, validState, type Musician } from './engine';
import { harmonicMotion, voiceChord } from './harmonic-motion';
import { ensembleRhythm, rhythmicDrive } from './ensemble-rhythm';
import { buildMessages } from './local-llm';
import { degreePitch, modes, type Mode } from './tonality';
import { orchestra } from './orchestra';
import { onsetGap } from './phrasing';
import type { MelodyDecision } from './melody';

const player = (name: string) => createMusician(orchestra.findIndex(p => p.name === name));
const decision: MelodyDecision = { motif: [5, 2, 3], rhythm: [0, 3, 10], durations: [2, 4, 4], articulations: ['legato', 'staccato', 'tenuto'], energy: .6, approach: 'echo', interval: 0, respondTo: 'self', reason: 'Keep this phrase.' };
const drum = (energy: number): Musician => ({ ...player('Snare drum'), energy, beat: 31, recentNotes: [{ step: 28, midi: 48, velocity: energy, duration: .2 }] });
const playBar = (m: Musician) => {
  const events: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const notes = compose(m);
    events.push(notes.map(n => n.midi));
    m = evolve(recordPerformance(m, notes, true), []);
    assert.ok(validState(m));
  }
  return { m, events };
};

test('bass and piano follow the same changing chords in every key and mode', () => {
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of Object.keys(modes) as Mode[]) {
    const key = { tonic, mode };
    for (let bar = 0; bar < 4; bar++) {
      const piano = { ...configureHarmony(player('Piano'), key, 'fixed'), beat: bar * 16 };
      const bass = { ...configureHarmony(player('Double bass'), key, 'fixed'), beat: bar * 16 };
      const chord = harmonicMotion(piano), pitches = chord.degrees.map(n => degreePitch(0, n, key) % 12);
      const notes = compose(piano);
      assert.equal(compose(bass)[0].midi % 12, pitches[0]);
      assert.equal(notes.length, chord.degrees.length);
      assert.ok(notes.every(n => pitches.includes(n.midi % 12)));
      assert.ok(validState(recordPerformance(piano, notes, true)));
      assert.deepEqual(harmonicMotion({ ...piano, energy: .9 }), harmonicMotion({ ...bass, energy: .2 }));
    }
  }
  assert.deepEqual([0, 16, 32, 48].map(beat => compose({ ...player('Double bass'), beat })[0].midi), [36, 45, 41, 43]);
});

test('piano voice leading reduces motion and reaches the scheduled audio events', () => {
  const key = { tonic: 0, mode: 'major' as const };
  const prior = [48, 52, 55], degrees = [5, 7, 9];
  const voiced = voiceChord(48, degrees, key, prior);
  const motion = (notes: number[]) => notes.reduce((sum, n, i) => sum + Math.abs(n - prior[i]), 0);
  assert.ok(motion(voiced) < motion(degrees.map(n => degreePitch(48, n, key))));
  assert.deepEqual(voiced, [48, 52, 57]);
  const piano = { ...player('Piano'), beat: 16, recentNotes: prior.map(midi => ({ midi, step: 8, duration: .5, velocity: .5 })) };
  assert.deepEqual(compose(piano).map(n => n.midi), voiced);
});

test('structured phrases lead to a dominant and resolve with a plain tonic chord', () => {
  const piano = advanceForm(configureForm(player('Piano'), { choice: 'aba', bars: 8 }));
  assert.equal(harmonicMotion({ ...piano, beat: 96 }).root, 4);
  const end = { ...piano, beat: 112 };
  assert.deepEqual(harmonicMotion(end), { root: 0, degrees: [0, 2, 4], tension: 0 });
  assert.deepEqual(compose(end).map(n => n.midi), [48, 52, 55]);
});

test('percussion energy changes fallback onsets at a bar boundary without extra hidden hits', () => {
  for (const name of ['Violin', 'Double bass', 'Piano']) {
    const m = { ...player(name), beat: 31, energy: .5 };
    const low = evolve(m, [drum(.2)]), high = evolve(m, [drum(.9)]);
    assert.ok(high.rhythm.length > low.rhythm.length, name);
    assert.deepEqual(evolve({ ...m, beat: 30 }, [drum(.9)]).rhythm, m.rhythm);
    const onsets = Array.from({ length: 16 }, (_, i) => compose({ ...high, beat: 32 + i }).length ? i : -1).filter(i => i >= 0);
    assert.deepEqual(onsets, high.rhythm);
    high.durations!.forEach((value, i) => assert.ok(value <= onsetGap(high.rhythm, i)));
  }
});

test('muted, stale and unreachable percussion cannot drive rhythmic choices', () => {
  const m = { ...player('Violin'), beat: 32 };
  const baseline = ensembleRhythm(m, []);
  assert.deepEqual(ensembleRhythm(m, [{ ...drum(.9), audible: false }]), baseline);
  assert.deepEqual(ensembleRhythm(m, [{ ...drum(.9), beat: 100 }]), baseline);
  const boundary = { ...m, beat: 31, energy: .44 };
  assert.deepEqual(evolve(boundary, [{ ...drum(.9), audible: false }]).rhythm, evolve(boundary, []).rhythm);
  assert.deepEqual(evolve(boundary, [{ ...drum(.9), beat: 100 }]).rhythm, evolve(boundary, []).rhythm);
  assert.equal(rhythmicDrive(m, []).hasDrums, false);
  assert.equal(rhythmicDrive(m, [drum(.9)]).hasDrums, true);
  const a = { ...drum(.2), id: 'a' }, b = { ...drum(.9), id: 'b' };
  assert.deepEqual(evolve({ ...m, beat: 31 }, [a, b]), evolve({ ...m, beat: 31 }, [b, a]));
});

test('snare ghost notes are quieter than the backbeat and unpitched voices remain single notes', () => {
  const snare = { ...player('Snare drum'), energy: .9, beat: 32 };
  Object.assign(snare, ensembleRhythm(snare, []));
  assert.ok(snare.rhythm.includes(4) && snare.rhythm.includes(12) && snare.rhythm.includes(7));
  assert.ok(compose({ ...snare, beat: 39 })[0].velocity < compose({ ...snare, beat: 36 })[0].velocity / 2);
  for (const name of ['Snare drum', 'Bass drum', 'Triangle']) {
    const m = { ...player(name), beat: 32, energy: .9 };
    Object.assign(m, ensembleRhythm(m, []));
    for (const step of m.rhythm) assert.equal(compose({ ...m, beat: 32 + step }).length, 1);
  }
});

test('an isolated melodic instrument develops its contour before the next bar plays', () => {
  const start = player('Violin');
  const first = playBar(start), second = playBar(first.m);
  assert.notDeepEqual(second.m.motif, start.motif);
  assert.notDeepEqual(playBar(second.m).events, first.events);
  assert.deepEqual(start.motif, [0, 2, 4, 2], 'Development does not mutate previous snapshots');
});

test('recorded openings and explicit recalls bypass accompaniment reharmonization', () => {
  for (const name of ['Double bass', 'Piano', 'Violin']) {
    const opening = seedMusician(player(name), decision);
    const first = playBar(opening), second = playBar(first.m);
    assert.deepEqual(first.events, second.events);
    const recalled = applyDecision({ ...player(name), beat: 16 }, { ...decision, themeAction: 'recall' });
    assert.deepEqual(recalled.motif, decision.motif);
    assert.equal(compose(recalled)[0].midi, degreePitch(orchestra[recalled.instrument].base, 5));
    let held = recalled;
    for (let i = 0; i < 64; i++) held = evolve(held, [drum(.9)]);
    assert.deepEqual(held.rhythm, decision.rhythm);
    assert.deepEqual(held.motif, decision.motif);
  }
});

test('accepted model rhythms keep their written rests while the chord progression advances', () => {
  const piano = applyDecision({ ...player('Piano'), beat: 16 }, decision);
  const first = playBar(piano), second = playBar(first.m);
  assert.deepEqual(first.events.map((n, i) => n.length ? i : -1).filter(i => i >= 0), decision.rhythm);
  assert.deepEqual(second.events.map((n, i) => n.length ? i : -1).filter(i => i >= 0), decision.rhythm);
  assert.deepEqual(second.m.motif, decision.motif);
});

test('local model context includes scale-safe chords and only audible rhythmic drive', () => {
  const self = { ...player('Violin'), beat: 32 };
  const before = structuredClone(self);
  const content = JSON.parse(buildMessages({ self, neighbours: [drum(.9)], memory: [] })[1].content);
  assert.deepEqual(content.harmony.accompaniment.notes, ['F', 'A', 'C', 'E']);
  assert.equal(content.rhythmicDrive.hasDrums, true);
  assert.deepEqual(self, before);
});
