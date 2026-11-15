import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceForm, applyDecision, compose, configureForm, createMusician, createOrchestra, evolve, musicianPhrasing, seedMusician, validState, type Musician } from './engine';
import { realizeStrategy } from './local-llm';
import { validDecision, type MelodyDecision } from './melody';
import { avoidRhythmicRepeat, normalizeRhythm, noteValues, onsetGap } from './phrasing';

const decision: MelodyDecision = { motif: [0, 2, 4, 2], rhythm: [0, 4, 8, 12], durations: [4, 4, 4, 4], articulations: ['legato', 'normal', 'accent', 'tenuto'],
  approach: 'echo', interval: 0, variation: 'keep', respondTo: 'self', energy: .5, reason: 'Answer with a new rhythm.', form: 'free', gesture: 'plain', themeAction: 'develop', keyChange: 'stay' };
function playBar(start: Musician) {
  let self = start;
  const events: { step: number; value?: number }[] = [];
  for (let step = 0; step < 16; step++) {
    const notes = compose(self);
    if (notes.length) events.push({ step, value: notes[0].noteValue });
    self = evolve(self, []);
    assert.ok(validState(self));
  }
  return { self, events };
}

test('repeating model onsets produces different scheduled rhythms and note values', () => {
  let self = { ...createMusician(0), beat: 16 };
  const memory: MelodyDecision[] = [], rhythms: string[] = [], values = new Set<number>();
  for (let phrase = 0; phrase < 18; phrase++) {
    const context = { self, neighbours: [], memory: memory.slice(-3) };
    const snapshot = structuredClone(context);
    const next = realizeStrategy(context, decision);
    assert.deepEqual(context, snapshot);
    assert.ok(validDecision(next));
    assert.ok(!rhythms.slice(-3).includes(next.rhythm.join()));
    assert.notDeepEqual(next.rhythm, self.rhythm);
    self = applyDecision(self, next);
    const bar = playBar(self);
    assert.deepEqual(bar.events.map(e => e.step), next.rhythm);
    assert.deepEqual(bar.events.map(e => e.value), next.durations);
    next.durations!.forEach(value => values.add(value));
    memory.push(next); rhythms.push(next.rhythm.join()); self = bar.self;
  }
  assert.ok(new Set(rhythms).size >= 5);
  assert.ok(values.size >= 3, 'Written note lengths must vary too.');
});

test('fresh rhythms and their per-note articulation are retained', () => {
  const phrase = { rhythm: [0, 3, 7], durations: [2, 3, 8] as const, articulations: ['legato', 'accent', 'tenuto'] as const };
  const input = { rhythm: phrase.rhythm, durations: [...phrase.durations], articulations: [...phrase.articulations] };
  assert.deepEqual(avoidRhythmicRepeat(input, [decision.rhythm], 1), input);
});

test('held LLM phrases change after two complete bars, at the boundary before playback', () => {
  let self = applyDecision({ ...createMusician(0), beat: 16 }, decision);
  const first = playBar(self), second = playBar(first.self);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(musicianPhrasing(first.self), normalizeRhythm(decision));
  assert.notDeepEqual(second.self.rhythm, decision.rhythm);
  const third = playBar(second.self);
  assert.notDeepEqual(third.events, first.events);
  assert.deepEqual(third.events.map(e => e.step), second.self.rhythm);
  assert.deepEqual(third.self.motif, decision.motif, 'Timing development preserves the chosen melody.');
  assert.deepEqual(third.self.decision, { ...decision, appliedAt: 16 }, 'Keep the original decision as musical memory.');
});

test('fallback rhythms evolve for every instrument even without a model or peers', () => {
  for (const instrument of createOrchestra()) {
    let self = instrument;
    const heard = new Set<string>();
    for (let bar = 0; bar < 16; bar++) {
      const result = playBar(self);
      if (result.events.length) heard.add(JSON.stringify(result.events));
      self = result.self;
    }
    assert.ok(heard.size >= 2, `Instrument ${instrument.instrument} should vary its sounding rhythm.`);
  }
});

test('opening phrases, section entrances and explicit theme recalls stay intact', () => {
  const opening = seedMusician(createMusician(0), decision);
  const first = playBar(opening), second = playBar(first.self);
  assert.deepEqual(first.events, second.events);
  assert.notDeepEqual(second.self.rhythm, opening.rhythm, 'Development begins after the two-bar opening.');
  const entrance = advanceForm(configureForm(createMusician(0), { choice: 'aba', bars: 4 }));
  const entered = playBar(entrance);
  assert.deepEqual(entered.events.map(e => e.step), entrance.rhythm);
  assert.deepEqual(entered.self.rhythm, entrance.rhythm);
  let recall = applyDecision({ ...entrance, beat: 16 }, { ...decision, form: 'aba', themeAction: 'recall' });
  for (let bar = 0; bar < 3; bar++) {
    const result = playBar(recall);
    assert.deepEqual(result.events.map(e => e.step), decision.rhythm);
    assert.deepEqual(result.events.map(e => e.value), decision.durations);
    recall = result.self;
  }
});

test('a new model decision replaces a held variation and establishes its rhythm again', () => {
  const old = applyDecision({ ...createMusician(0), beat: 16 }, decision);
  const held = playBar(playBar(old).self).self;
  const fresh = { ...decision, rhythm: [0, 3, 10], durations: [2, 6, 4] as const, articulations: ['legato', 'accent', 'tenuto'] as const };
  const next = applyDecision(held, { ...fresh, durations: [...fresh.durations], articulations: [...fresh.articulations] });
  const first = playBar(next), second = playBar(first.self);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.events.map(e => e.step), fresh.rhythm);
  assert.deepEqual(first.events.map(e => e.value), fresh.durations);
});

test('edits stay sorted, aligned and inside the bar for sparse and dense rhythms', () => {
  for (const rhythm of [[0], [15], [0, 8], decision.rhythm, Array.from({ length: 16 }, (_, i) => i)]) {
    for (let seed = 0; seed < 26; seed++) for (const gesture of ['plain', 'legato', 'staccato']) {
      const result = avoidRhythmicRepeat({ rhythm }, [rhythm], seed, gesture);
      assert.notDeepEqual(result.rhythm, rhythm);
      assert.ok(validDecision({ ...decision, ...result }));
      assert.equal(result.articulations.length, result.rhythm.length);
      assert.ok(result.durations.every((value, i) => noteValues.includes(value) && value <= onsetGap(result.rhythm, i)));
      if (gesture !== 'plain') assert.ok(result.articulations.every(a => a === gesture));
    }
  }
});
