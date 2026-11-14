import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formIds, formPlans, formPosition, gestures, type FormId } from './forms';
import { AudioEngine, advanceForm, applyDecision, compose, configureForm, createMusician, evolve, recordPerformance, seedMusician, validState, type Musician } from './engine';
import { buildMessages, LocalBrains, ollamaDecider, realizeStrategy, responseSchema } from './local-llm';
import { validDecision, validStrategy, type MelodyDecision } from './melody';
import { orchestra } from './orchestra';
const decision: MelodyDecision = { motif: [5, 4, 3, 2], rhythm: [0, 4, 8, 12], energy: .5, approach: 'echo', interval: 0, respondTo: 'self', reason: 'Recall the theme with ornaments.', form: 'aba', gesture: 'mordent', themeAction: 'recall' };
const configured = (choice: FormId = 'aba', instrument = 0) => configureForm(createMusician(instrument), { choice, bars: 4 });
const enter = (m: Musician, beat: number) => advanceForm({ ...m, beat });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('ABA restores A and ABB repeats B, preserving themes through model developments', () => {
  for (const form of ['aba', 'abb'] as const) {
    let m = enter(configured(form), 0);
    const original = [...m.motif];
    m = applyDecision({ ...m, beat: 16 }, decision);
    assert.notDeepEqual(m.motif, original);
    m = enter(m, 64); const b = [...m.motif];
    assert.notDeepEqual(b, original);
    m = applyDecision({ ...m, beat: 80 }, { ...decision, motif: [1, 1, 2, 2] });
    m = enter(m, 128);
    assert.deepEqual(m.motif, form === 'aba' ? original : b);
    assert.equal(m.decision, undefined);
    assert.equal(applyDecision(m, decision), m, 'The first bar of a return cannot be overwritten');
    assert.equal(validState(m), true);
    const message = JSON.parse(buildMessages({ self: m, neighbours: [], memory: [] })[1].content);
    assert.equal(message.structure.returning, true);
    assert.deepEqual(message.structure.rememberedTheme.motif, m.motif);
  }
});

test('pop recalls the chorus hook; classical traverses four distinct movements', () => {
  let pop = enter(configured('pop'), 0);
  pop = enter(pop, 64 * 2); const chorus = [...pop.motif];
  pop = enter(pop, 64 * 3);
  pop = enter(pop, 64 * 4); assert.deepEqual(pop.motif, chorus);
  pop = enter(pop, 64 * 5); assert.equal(formPosition(pop.form, pop.beat).label, 'Bridge');
  pop = enter(pop, 64 * 6); assert.deepEqual(pop.motif, chorus);
  const movements = [0, 5, 8, 11].map(index => {
    let m = enter(configured('classical'), index * 64);
    for (let i = 0; i < 32; i++) m = evolve(m, []);
    return { name: formPosition(m.form, m.beat).movementName, tempo: m.tempo, gesture: m.form!.gesture };
  });
  assert.equal(new Set(movements.map(m => m.name)).size, 4);
  assert.ok(movements[1].tempo < movements[0].tempo - 20);
  assert.ok(movements[3].tempo > movements[1].tempo + 30);
  assert.equal(movements[1].gesture, 'legato'); assert.equal(movements[2].gesture, 'mordent');
  assert.deepEqual(formPlans.classical.slice(11).map(s => s.theme), ['A', 'B', 'A', 'C', 'A']);
});

test('arpeggios, mordents, trills and articulation reach actual timed note events', () => {
  const m = { ...createMusician(0), beat: 16 };
  const notes = (gesture: typeof gestures[number]) => compose(applyDecision(m, { ...decision, motif: [0, 1, 2, 3, 4, 5, 6, 0], gesture }));
  assert.deepEqual(notes('arpeggio').map(n => n.midi), [72, 76, 79]);
  assert.deepEqual(notes('mordent').map(n => n.midi), [72, 71, 72]);
  assert.deepEqual(notes('trill').map(n => n.midi), [72, 74, 72, 74]);
  for (const gesture of ['arpeggio', 'mordent', 'trill'] as const) {
    const played = notes(gesture);
    assert.ok(played.every((n, i) => Number.isFinite(n.midi) && n.duration > 0 && (i === 0 || n.offset! > played[i - 1].offset!)));
    const history = recordPerformance(m, played, true);
    assert.deepEqual(history.recentNotes.map(n => n.offset), played.map(n => n.offset)); assert.ok(validState(history));
  }
  assert.ok(notes('legato')[0].duration > notes('plain')[0].duration);
  assert.ok(notes('staccato')[0].duration < notes('plain')[0].duration);
  const ostinato = applyDecision(m, { ...decision, motif: [0, 1, 2, 3, 4, 5, 6, 0], gesture: 'ostinato' });
  assert.equal(compose({ ...ostinato, beat: 32 })[0].midi, 72, 'The four-note cell repeats');
  const drum = applyDecision({ ...createMusician(18), beat: 16 }, { ...decision, gesture: 'mordent' });
  assert.equal(compose(drum).length, 1, 'Unpitched percussion does not acquire a pitched ornament');
});

test('every form and instrument stays valid across repeated section boundaries', () => {
  for (const form of formIds) for (let instrument = 0; instrument < orchestra.length; instrument++) {
    let m = configured(form, instrument);
    for (let section = 0; section < formPlans[form].length * 2; section++) {
      m = enter(m, section * 64);
      m = recordPerformance(m, compose(m), true);
      assert.ok(validState(m), `${form}/${orchestra[instrument].name}/${section}`);
      assert.ok(compose(m).every(n => n.midi >= 12 && n.midi <= 120));
    }
    assert.ok(Object.keys(m.form!.themes).length <= 12);
  }
});

test('ornament offsets reach the audio scheduler and section endings return to the home note', () => {
  const m = applyDecision({ ...enter(configured(), 0), beat: 16 }, { ...decision, gesture: 'plain' });
  assert.equal(compose({ ...m, beat: 60 })[0].midi, 72);
  assert.notEqual(compose({ ...m, beat: 44 })[0].midi, 72);
  const times: number[] = [];
  const instrument = { ...m, decision: { ...decision, gesture: 'mordent' as const, appliedAt: 16 } };
  const notes = compose(instrument);
  const fakeEngine = { play: (_profile: unknown, _instrument: number, _note: unknown, time: number) => times.push(time) } as unknown as AudioEngine;
  AudioEngine.prototype.note.call(fakeEngine, instrument, 10, notes);
  assert.deepEqual(times, notes.map(n => 10 + (n.offset ?? 0)));
  assert.ok(times[1] > times[0] && times[2] > times[1]);
});

test('agent choice is latched, preset and gesture focus constrain model output', async t => {
  let auto = configureForm(createMusician(0), { choice: 'auto', bars: 8 });
  assert.deepEqual(responseSchema({ self: auto, neighbours: [], memory: [] }).properties.form.enum, formIds.filter(id => id !== 'free'));
  auto = applyDecision({ ...auto, beat: 16 }, { ...decision, form: 'pop' });
  assert.equal(auto.form!.selected, 'pop');
  auto = applyDecision({ ...auto, beat: 32 }, { ...decision, form: 'classical' });
  assert.equal(auto.form!.selected, 'pop', 'An agent keeps its chosen form');
  const self = configureForm(createMusician(0), { choice: 'aba', bars: 4, expression: 'arpeggio' });
  const context = { self, neighbours: [], memory: [] };
  assert.deepEqual(responseSchema(context).properties.form.enum, ['aba']);
  assert.deepEqual(responseSchema(context).properties.gesture.enum, ['arpeggio']);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: { content: JSON.stringify(decision) } })));
  await assert.rejects(ollamaDecider('qwen3:1.7b')(context, new AbortController().signal), /gesture focus/);
  assert.equal(validStrategy({ ...decision, gesture: 'execute-code' }), false);
  assert.equal(validStrategy({ ...decision, form: 'invented' }), false);
  assert.equal(validState({ ...self, form: { ...self.form, bars: -1 } }), false);
  assert.equal(validState({ ...self, recentNotes: [{ step: 0, midi: 60, duration: .2, velocity: .5, offset: -1 }] }), false);
});

test('theme recall preserves short uploaded motifs; new seeds reset remembered themes', () => {
  let m = configureForm(seedMusician(createMusician(0), { motif: [5, 2, 3], rhythm: [0, 4, 8] }), { choice: 'aba', bars: 4 });
  m = enter(m, 32);
  const recalled = realizeStrategy({ self: m, neighbours: [], memory: [] }, decision);
  assert.deepEqual(recalled.motif, [5, 2, 3]); assert.deepEqual(recalled.rhythm, [0, 4, 8]); assert.ok(validDecision(recalled));
  m = enter(m, 96);
  const reseeded = seedMusician(m, { motif: [0, 4, 2], rhythm: [0, 3, 10] });
  assert.deepEqual(reseeded.form!.themes, {}); assert.deepEqual(reseeded.form!.home.motif, [0, 4, 2]);
  assert.equal(reseeded.form!.selected, 'aba'); assert.equal(reseeded.form!.startBeat, 32);
  assert.equal(reseeded.form!.enteredAt, undefined); assert.equal(reseeded.form!.token, undefined); assert.ok(validState(reseeded));
});

test('a response from a previous section is discarded without erasing theme memory', async () => {
  let m = { ...enter(configured(), 0), beat: 48 };
  let finish!: (value: MelodyDecision) => void;
  const brains = new LocalBrains(() => new Promise(resolve => { finish = resolve; }), () => ({ self: m, reachable: [] }), () => {});
  try {
    brains.tick([m.id]);
    m = enter(m, 64); const theme = [...m.motif];
    finish(decision); await flush();
    m = { ...m, beat: 80 };
    assert.deepEqual(brains.atBar(m).motif, theme);
    assert.equal(brains.atBar(m).decision, undefined);
    assert.ok(m.form!.themes['1:A']);
  } finally { brains.dispose(); }
});
