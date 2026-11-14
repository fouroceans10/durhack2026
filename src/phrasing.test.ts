import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceForm, applyDecision, compose, configureForm, createMusician, createOrchestra, musicianPhrasing, recordPerformance, seedMusician, validState } from './engine';
import { gestures } from './forms';
import { buildMessages, ollamaDecider, realizeStrategy } from './local-llm';
import { validDecision, validStartingMotif, validStrategy, type MelodyDecision } from './melody';
import { articulations, normalizeRhythm, noteValues, onsetGap, phrasingIdeas, type Articulation } from './phrasing';

const decision: MelodyDecision = { motif: [0, 1, 2, 3], rhythm: [0, 1, 3, 7], durations: [1, 2, 4, 8], articulations: ['legato', 'staccato', 'accent', 'tenuto'],
  energy: .5, approach: 'echo', interval: 0, respondTo: 'self', reason: 'A short run opens into a held answer.', form: 'free', gesture: 'plain', themeAction: 'develop', keyChange: 'stay' };
const player = () => ({ ...createMusician(0), beat: 16, tempo: 120 });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('every written note value has the correct tempo-relative duration', () => {
  for (const tempo of [60, 120, 180]) for (const value of noteValues) {
    const m = applyDecision({ ...player(), tempo }, { ...decision, rhythm: [0], durations: [value], articulations: ['tenuto'] });
    near(compose(m)[0].duration, value * 60 / tempo / 4);
    assert.equal(compose(m)[0].noteValue, value);
  }
});

test('a mixed phrase produces semiquavers, quavers, crotchets and minims with real rests', () => {
  const m = applyDecision(player(), decision);
  const notes = decision.rhythm.map(step => compose({ ...m, beat: 16 + step })[0]);
  assert.deepEqual(notes.map(n => n.noteValue), [1, 2, 4, 8]);
  assert.deepEqual(notes.map(n => n.articulation), decision.articulations);
  assert.equal(compose({ ...m, beat: 18 }).length, 0);
  assert.equal(compose({ ...m, beat: 31 }).length, 0);
  near(notes[3].duration, 1); assert.ok(notes[2].velocity > m.energy);
});

test('sorting and deduplication retain the associated length and articulation', () => {
  const source = { rhythm: [8, 0, 0, 4], durations: [8, 2, 1, 3] as const, articulations: ['tenuto', 'legato', 'staccato', 'accent'] as const };
  const phrase = { rhythm: source.rhythm, durations: [...source.durations], articulations: [...source.articulations] };
  assert.deepEqual(normalizeRhythm(phrase), { rhythm: [0, 4, 8], durations: [2, 3, 8], articulations: ['legato', 'accent', 'tenuto'] });
  const applied = applyDecision(player(), { ...decision, rhythm: [8, 0, 4], durations: [8, 2, 3], articulations: ['tenuto', 'legato', 'accent'] });
  assert.deepEqual(applied.durations, [2, 3, 8]); assert.deepEqual(applied.articulations, ['legato', 'accent', 'tenuto']);
});

test('overlong notes fit before the next onset and the bar line', () => {
  const m = applyDecision(player(), { ...decision, rhythm: [0, 5, 15], durations: [16, 16, 16], articulations: ['tenuto', 'tenuto', 'tenuto'] });
  assert.deepEqual(m.durations, [4, 8, 1]);
  for (const [i, step] of m.rhythm.entries()) assert.ok(compose({ ...m, beat: 16 + step })[0].duration <= onsetGap(m.rhythm, i) / 8);
});

test('legato connects adjacent notes, staccato detaches, and neither erases a written rest', () => {
  const note = (articulation: Articulation, durations: (1 | 2 | 4)[] = [4, 4]) => applyDecision(player(), { ...decision, rhythm: [0, 4], durations, articulations: [articulation, articulation] });
  near(compose(note('staccato'))[0].duration, .2);
  near(compose(note('tenuto'))[0].duration, .5);
  assert.ok(compose(note('legato'))[0].duration > .5);
  near(compose(note('legato', [2, 4]))[0].duration, .25);
  const end = applyDecision(player(), { ...decision, rhythm: [12], durations: [4], articulations: ['legato'] });
  near(compose({ ...end, beat: 28 })[0].duration, .5,);
});

test('every instrument, written value, gesture and articulation stays valid at tempo limits', () => {
  for (const m of createOrchestra()) for (const tempo of [60, 180]) for (const value of noteValues) for (const gesture of gestures) for (const articulation of articulations) {
    const at = applyDecision({ ...m, beat: 16, tempo }, { ...decision, rhythm: [0], durations: [value], articulations: [articulation], gesture });
    const notes = compose(at);
    assert.ok(notes.length && validState(recordPerformance(at, notes, true)), `${m.instrument}/${tempo}/${value}/${gesture}/${articulation}`);
    assert.ok(notes.every(n => (n.offset ?? 0) + n.duration <= value * 60 / tempo / 4 + .040001));
  }
});

test('phrasing works with arpeggios and the chosen gesture focus overrides model articulation', () => {
  const arpeggio = (articulation: Articulation) => compose(applyDecision(player(), { ...decision, rhythm: [0], durations: [8], articulations: [articulation], gesture: 'arpeggio' }));
  const detached = arpeggio('staccato'), connected = arpeggio('legato');
  assert.equal(detached.length, 3); assert.ok(detached.every((n, i) => n.duration < connected[i].duration));
  for (const expression of ['legato', 'staccato'] as const) {
    const m = configureForm(player(), { choice: 'free', bars: 4, expression });
    const next = applyDecision(m, decision);
    assert.deepEqual(musicianPhrasing(next).articulations, Array(4).fill(expression));
    assert.equal(compose(next)[0].articulation, expression);
  }
});

test('theme returns and recalls retain note values; a fresh seed resets phrasing without aliases', () => {
  const phrase = { motif: [0, 2, 4, 2], rhythm: [0, 1, 3, 7], durations: [1, 2, 4, 8] as const, articulations: ['legato', 'legato', 'staccato', 'tenuto'] as const };
  let m = configureForm(seedMusician(player(), { ...phrase, durations: [...phrase.durations], articulations: [...phrase.articulations] }), { choice: 'aba', bars: 4, expression: 'plain' });
  m = advanceForm({ ...m, beat: 32 });
  m = advanceForm({ ...m, beat: 96 }); m = advanceForm({ ...m, beat: 160 });
  const ownDurations = m.durations!;
  assert.deepEqual(m.durations, phrase.durations); assert.deepEqual(m.articulations, phrase.articulations);
  const recalled = realizeStrategy({ self: m, neighbours: [], memory: [] }, { ...decision, themeAction: 'recall' });
  assert.deepEqual(recalled.durations, phrase.durations); assert.deepEqual(recalled.articulations, phrase.articulations);
  ownDurations[0] = 2; assert.equal(m.form!.themes['1:A'].durations![0], 1);
  const seeded = seedMusician(m, { motif: [0], rhythm: [0], durations: [16], articulations: ['tenuto'] });
  assert.deepEqual(seeded.durations, [16]); assert.deepEqual(seeded.form!.themes, {});
});

test('neighbours and previous decisions expose performed lengths, articulation and alternatives', () => {
  const m = applyDecision(player(), decision), played = recordPerformance(m, compose(m), true);
  const payload = JSON.parse(buildMessages({ self: m, neighbours: [played], memory: [decision] })[1].content);
  assert.equal(payload.neighbours[0].played[0][6], 1); assert.equal(payload.neighbours[0].played[0][7], 'legato');
  assert.deepEqual(payload.self.durations, decision.durations); assert.deepEqual(payload.previousDecisions[0].articulations, decision.articulations);
  assert.ok(payload.phraseExperiment.ideas.length > 0);
  assert.ok(payload.phraseExperiment.ideas.every((idea: { rhythm: number[] }) => idea.rhythm.join() !== m.rhythm.join()));
  assert.notDeepEqual(phrasingIdeas(0, 16, []), phrasingIdeas(1, 16, []));
});

test('malformed duration and articulation arrays are rejected, while older peer data still works', async t => {
  for (const invalid of [{ durations: [0, 2, 4, 8] }, { durations: [1, 2] }, { durations: [1, NaN, 4, 8] }, { articulations: ['legato'] }, { articulations: ['execute', 'normal', 'normal', 'normal'] }]) {
    assert.equal(validStrategy({ ...decision, ...invalid }), false);
    assert.equal(validDecision({ ...decision, ...invalid }), false);
    assert.equal(validState({ ...player(), ...decision, ...invalid }), false);
    assert.equal(validStartingMotif({ ...decision, ...invalid } as unknown as Parameters<typeof validStartingMotif>[0]), false);
  }
  const legacy = { ...decision, durations: undefined, articulations: undefined };
  assert.ok(validDecision(legacy)); assert.ok(validState(applyDecision(player(), legacy)));
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: { content: JSON.stringify(legacy) } })));
  await assert.rejects(ollamaDecider('qwen3:1.7b')({ self: player(), neighbours: [], memory: [] }, new AbortController().signal), /omitted note lengths/);
});

test('all sixteen semiquaver entrances fit in a bar and can be recalled as a theme', () => {
  const d = { ...decision, rhythm: Array.from({ length: 16 }, (_, i) => i), durations: Array(16).fill(1), articulations: Array(16).fill('staccato') };
  assert.ok(validDecision(d)); const m = applyDecision(player(), d);
  assert.equal(Array.from({ length: 16 }, (_, i) => compose({ ...m, beat: 16 + i })).flat().length, 16);
  const theme = configureForm(m, { choice: 'aba', bars: 4 });
  const recalled = realizeStrategy({ self: theme, neighbours: [], memory: [] }, { ...d, themeAction: 'recall' });
  assert.equal(recalled.rhythm.length, 16); assert.ok(validDecision(recalled));
});
