import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedKeyChanges, advanceForm, applyDecision, compose, configureForm, configureHarmony, createMusician, createOrchestra, evolve, recordPerformance, seedMusician, validState } from './engine';
import { gestures, formPosition } from './forms';
import { buildMessages, LocalBrains, realizeStrategy, responseSchema, type BrainStatus } from './local-llm';
import { validDecision, validStartingMotif, type MusicalStrategy } from './melody';
import { adaptMotif, extractMotif, ANALYSIS_RATE } from './motif-extraction';
import { isPitched, orchestra } from './orchestra';
import { currentKey, degreeName, degreePitch, homeKey, keyName, modes, nearestDegree, randomTonality, relatedKey, sectionKey, validHarmony, type Mode, type Tonality } from './tonality';

const C: Tonality = { tonic: 0, mode: 'major' }, G: Tonality = { tonic: 7, mode: 'major' }, Dm: Tonality = { tonic: 2, mode: 'minor' };
const strategy: MusicalStrategy = { approach: 'echo', interval: 0, energy: .5, reason: 'Develop the neighbouring phrase.', respondTo: 'self', rhythm: [0, 4, 8, 12], form: 'free', gesture: 'plain', themeAction: 'develop', keyChange: 'stay' };
const player = (key = C, policy: 'fixed' | 'form' | 'agent' = 'fixed') => ({ ...configureHarmony(createMusician(0), key, policy), beat: 16 });
const decision = { ...strategy, motif: [0, 2, 4, 1] };

test('all 96 scales round-trip MIDI across registers and spell accidentals', () => {
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of Object.keys(modes) as Mode[]) {
    const key = { tonic, mode };
    for (let degree = -14; degree <= 20; degree++) {
      assert.equal(nearestDegree(degreePitch(48, degree, key), key), (degree % 7 + 7) % 7);
      assert.ok(degreeName(degree, key).length <= 3, `${keyName(key)} degree ${degree}`);
    }
  }
  assert.deepEqual(modes.major.map((_, i) => degreeName(i, { tonic: 6, mode: 'major' })), ['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯']);
  assert.equal(degreeName(6, { tonic: 2, mode: 'harmonicMinor' }), 'C♯');
  assert.equal(degreeName(2, { tonic: 10, mode: 'minor' }), 'D♭');
});

test('every instrument and ornament synthesizes valid pitches in every key and mode', () => {
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of Object.keys(modes) as Mode[]) for (const m of createOrchestra()) for (const gesture of gestures) {
    const self = { ...configureHarmony(m, { tonic, mode }, 'fixed'), motif: [0, 6], rhythm: [0, 8], beat: 16, decision: { ...decision, motif: [0, 6], gesture, appliedAt: 16 } };
    for (const beat of [16, 24]) {
      const at = { ...self, beat }, notes = compose(at);
      assert.ok(validState(recordPerformance(at, notes, true)), `${orchestra[m.instrument].name} ${tonic} ${mode} ${gesture}`);
      if (isPitched(m.instrument)) assert.ok(notes.every(n => modes[mode].some(interval => (tonic + interval) % 12 === n.midi % 12)));
    }
  }
});

test('changing mode changes the third; unpitched percussion keeps its sound', () => {
  const phrase = { motif: [2], rhythm: [0] };
  const major = seedMusician(player({ tonic: 2, mode: 'major' }), phrase), minor = seedMusician(player(Dm), phrase);
  assert.equal(compose(major)[0].midi - compose(minor)[0].midi, 1);
  for (const m of createOrchestra().filter(m => !isPitched(m.instrument))) assert.deepEqual(compose(configureHarmony(m, Dm, 'form')), compose(m));
});

test('form-led ABA departs to the dominant and restores theme and home key', () => {
  let m = configureForm(player(C, 'form'), { choice: 'aba', bars: 4 });
  m = advanceForm(m); const theme = [...m.motif];
  m = advanceForm({ ...m, beat: 80 }); assert.deepEqual(currentKey(m), G);
  assert.equal(compose(m)[0].midi % 12, degreePitch(0, m.motif[0], G) % 12);
  m = advanceForm({ ...m, beat: 144 }); assert.deepEqual(currentKey(m), C); assert.deepEqual(m.motif, theme);
  assert.ok(validState(m));
  let minor = configureForm(player(Dm, 'form'), { choice: 'aba', bars: 4 });
  minor = advanceForm({ ...advanceForm(minor), beat: 80 });
  assert.deepEqual(currentKey(minor), { tonic: 5, mode: 'major' });
});

test('classical recapitulation brings B home; movements and pop bridge have distinct keys', () => {
  let m = configureForm(player(G, 'form'), { choice: 'classical', bars: 4 });
  m = advanceForm({ ...advanceForm(m), beat: 80 }); const theme = [...m.motif];
  assert.deepEqual(currentKey(m), { tonic: 2, mode: 'major' });
  m = advanceForm({ ...m, beat: 272 }); assert.deepEqual(currentKey(m), G); assert.deepEqual(m.motif, theme);
  m = advanceForm({ ...m, beat: 336 }); assert.deepEqual(currentKey(m), { tonic: 4, mode: 'minor' });
  assert.deepEqual(sectionKey(C, { form: 'pop', theme: 'B', movement: 1, index: 2 }), C);
  assert.deepEqual(sectionKey(C, { form: 'pop', theme: 'C', movement: 1, index: 5 }), { tonic: 9, mode: 'minor' });
  assert.deepEqual(relatedKey({ tonic: 2, mode: 'dorian' }, 'relative'), C);
});

test('fixed keys reject modulation while agent choices apply only at bar boundaries', () => {
  const fixed = player(Dm), agent = player(Dm, 'agent');
  assert.equal(applyDecision(fixed, { ...decision, keyChange: 'relative' }), fixed);
  const midBar = { ...agent, beat: 17 };
  assert.equal(applyDecision(midBar, { ...decision, keyChange: 'relative' }), midBar);
  const moved = applyDecision(agent, { ...decision, keyChange: 'relative' });
  assert.deepEqual(currentKey(moved), { tonic: 5, mode: 'major' }); assert.deepEqual(homeKey(moved), Dm);
  assert.deepEqual(allowedKeyChanges(moved), ['stay']);
  assert.ok(allowedKeyChanges({ ...moved, beat: 64 }).includes('home'));
  assert.deepEqual(currentKey(applyDecision({ ...moved, beat: 64 }, { ...decision, keyChange: 'home' })), Dm);
});

test('opening and section returns protect theme keys; new sections allow one modulation', () => {
  const seeded = seedMusician(player(C, 'agent'), { motif: [0, 2, 4], rhythm: [0, 4, 8] });
  assert.deepEqual(allowedKeyChanges(seeded), ['stay']);
  let m = advanceForm(configureForm(player(C, 'agent'), { choice: 'aba', bars: 4 }));
  assert.deepEqual(allowedKeyChanges(m), ['stay']);
  m = applyDecision({ ...m, beat: 32 }, { ...decision, keyChange: 'dominant' });
  assert.deepEqual(currentKey(m), G);
  assert.deepEqual(allowedKeyChanges({ ...m, beat: 48 }), ['stay']);
  m = advanceForm({ ...m, beat: 80 });
  assert.ok(allowedKeyChanges({ ...m, beat: 96 }).includes('parallel'));
  m = advanceForm({ ...m, beat: 144 });
  assert.deepEqual(currentKey(m), C); assert.deepEqual(allowedKeyChanges({ ...m, beat: 160 }), ['stay']);
});

test('listening uses chromatic MIDI from other keys and realizes in the destination key', () => {
  const self = player(Dm, 'agent');
  const partner = { ...configureHarmony(createMusician(1), { tonic: 6, mode: 'major' }, 'fixed'), beat: 16, recentNotes: [66, 70, 73].map(midi => ({ midi, step: 15, duration: .3, velocity: .5 })) };
  const context = { self, neighbours: [partner], memory: [] };
  const payload = JSON.parse(buildMessages(context)[1].content);
  assert.equal(payload.harmony.current, 'D natural minor'); assert.equal(payload.neighbours[0].key, 'F♯ major');
  assert.deepEqual(payload.neighbours[0].played.map((n: number[]) => n[1]), [66, 70, 73]);
  assert.equal(payload.harmony.destinations.relative, 'F major');
  const d = realizeStrategy(context, { ...strategy, respondTo: 'Viola', keyChange: 'relative' });
  assert.deepEqual(d.tonality, { tonic: 5, mode: 'major' });
  assert.deepEqual(d.motif.slice(0, 3), [66, 70, 73].map(n => nearestDegree(n, d.tonality)));
  const fallback = evolve(self, [partner]); assert.notDeepEqual(fallback.motif, self.motif);
  assert.deepEqual(responseSchema({ ...context, self: player(Dm) }).properties.keyChange.enum, ['stay']);
});

test('late decisions from a previous key are discarded without incrementing accepted phrases', async () => {
  let self = player(C); const states: BrainStatus[] = [];
  const brains = new LocalBrains(async () => ({ ...decision, tonality: C }), () => ({ self, reachable: [] }), (_, status) => states.push(status));
  try {
    brains.tick([self.id]); await new Promise(resolve => setImmediate(resolve));
    self = configureHarmony(self, Dm, 'fixed');
    assert.equal(brains.atBar(self), self); assert.equal(states.at(-1)?.decisions, 0);
    assert.equal(states.at(-1)?.phase, 'listening');
  } finally { brains.dispose(); }
});

test('uploaded PCM is mapped into the selected scale and remaps from original MIDI', () => {
  const midiNotes = [62, 65, 69, 70, 73], samples = new Float32Array(ANALYSIS_RATE * 3);
  midiNotes.forEach((midi, note) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < ANALYSIS_RATE * .3; i++) samples[Math.round((.2 + note * .5) * ANALYSIS_RATE) + i] = .3 * Math.sin(i / ANALYSIS_RATE * Math.PI * 2 * frequency);
  });
  const key: Tonality = { tonic: 2, mode: 'harmonicMinor' };
  const result = extractMotif(samples, ANALYSIS_RATE, () => {}, key);
  assert.deepEqual(result.motif, [0, 2, 4, 5, 6]); assert.ok(validStartingMotif(result));
  const adapted = adaptMotif(result, G);
  assert.deepEqual(adapted.notes.map(n => n.midi), midiNotes); assert.deepEqual(adapted.rhythm, result.rhythm);
  assert.deepEqual(adapted.motif, midiNotes.map(n => nearestDegree(n, G)));
  const m = seedMusician(player(C), adapted);
  assert.deepEqual(currentKey(m), G);
  assert.deepEqual(adapted.rhythm.map(beat => compose({ ...m, beat })[0].midi % 12), adapted.motif.map(n => degreePitch(0, n, G) % 12));
});

test('new seeds retain home policy, clear modulations and cached themes', () => {
  let m = configureForm(player(Dm, 'agent'), { choice: 'aba', bars: 4 });
  m = applyDecision({ ...advanceForm(m), beat: 32 }, { ...decision, keyChange: 'relative' });
  const seeded = seedMusician(m, { motif: [0, 1, 2], rhythm: [0, 4, 8] });
  assert.deepEqual(currentKey(seeded), Dm); assert.equal(seeded.harmony?.modulation, 'agent');
  assert.deepEqual(seeded.form?.themes, {}); assert.equal(seeded.harmony?.changedIn, undefined);
  assert.equal(formPosition(seeded.form, seeded.beat).waiting, true); assert.ok(validState(seeded));
});

test('invalid peer tonality and stale decision keys cannot reach synthesis', () => {
  const m = player();
  for (const key of [{ tonic: 12, mode: 'major' }, { tonic: 1.5, mode: 'major' }, { tonic: 0, mode: '__proto__' }, { tonic: 0, mode: ['major'] }]) {
    assert.equal(validState({ ...m, harmony: { ...m.harmony, current: key } }), false);
    assert.equal(validDecision({ ...decision, tonality: key }), false);
  }
  assert.equal(validHarmony({ ...m.harmony, modulation: '__proto__' }), false);
  assert.equal(validHarmony({ ...m.harmony, modulation: ['agent'] }), false);
  assert.equal(applyDecision(m, { ...decision, tonality: Dm }), m);
  assert.throws(() => configureHarmony(m, { tonic: -1, mode: 'major' }, 'fixed'));
  for (let i = 0; i < 100; i++) assert.notDeepEqual(randomTonality(C), C);
});
