import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceForm, applyDecision, compose, configureForm, configureHarmony, createMusician, validState } from './engine';
import { buildMessages, realizeStrategy, responseSchema } from './local-llm';
import { melodicVariations, transformMelody } from './melodic-variation';
import { validDecision, validStrategy, type MelodyDecision, type MusicalStrategy } from './melody';
import { degreePitch, modes, type Mode } from './tonality';

const strategy: MusicalStrategy = { approach: 'echo', interval: 0, variation: 'keep', energy: .5,
  respondTo: 'Viola', reason: 'Develop the heard phrase.', rhythm: [0, 4, 8, 12],
  durations: [4, 4, 4, 4], articulations: ['normal', 'normal', 'normal', 'tenuto'],
  form: 'free', gesture: 'plain', themeAction: 'develop', keyChange: 'stay' };
const neighbour = (beat: number) => ({ ...createMusician(1), beat,
  recentNotes: [0, 2, 4, 2].map((degree, i) => ({ midi: degreePitch(60, degree), step: beat - 4 + i, duration: .3, velocity: .5 })) });
const firstBar = (self: ReturnType<typeof createMusician>) => Array.from({ length: 16 }, (_, i) => compose({ ...self, beat: self.beat + i })).flat().map(note => note.midi);

test('repeated melodic choices change audible openings, not just unplayed motif tails', () => {
  let self = { ...createMusician(0), beat: 16 };
  const memory: MelodyDecision[] = [], played: number[][] = [];
  for (let phrase = 0; phrase < 24; phrase++) {
    const context = { self, neighbours: [neighbour(self.beat)], memory: memory.slice(-3) };
    const before = structuredClone(context);
    // Supply fresh four-note rhythms so the independent timing guard does not
    // change the number of pitches being compared in this melodic regression.
    const choice = { ...strategy, rhythm: [0, 1 + phrase % 3, 6 + Math.floor(phrase / 3) % 3, 12 + Math.floor(phrase / 9) % 3] };
    const decision = realizeStrategy(context, choice);
    assert.deepEqual(context, before, 'Realization must not change peer or memory state.');
    assert.deepEqual(realizeStrategy(context, choice), decision, 'Identical observations stay deterministic.');
    self = applyDecision(self, decision);
    const notes = firstBar(self);
    for (const recent of played.slice(-3)) {
      assert.ok(notes.filter((note, i) => note !== recent[i]).length >= 2, 'At least two of the four sounding pitches must change.');
    }
    assert.ok(validState(self));
    played.push(notes); memory.push(decision); self = { ...self, beat: self.beat + 16 };
  }
  assert.ok(new Set(played.map(notes => notes.join())).size >= 6, 'Do not just alternate two phrases.');
});

test('a sustained one-note phrase changes the note that actually sounds', () => {
  let self = { ...createMusician(0), motif: Array(8).fill(0), beat: 16 };
  const memory: MelodyDecision[] = [], roots: number[] = [];
  for (let phrase = 0; phrase < 12; phrase++) {
    const decision = realizeStrategy({ self, neighbours: [], memory: memory.slice(-3) }, {
      ...strategy, respondTo: 'self', rhythm: [phrase], durations: [16], articulations: ['tenuto'],
    });
    self = applyDecision(self, decision);
    const root = firstBar(self)[0];
    assert.ok(!roots.slice(-3).includes(root));
    roots.push(root); memory.push(decision); self = { ...self, beat: self.beat + 16 };
  }
});

test('each variation makes a distinct contour and keeps scale degrees bounded', () => {
  const motif = [1, 2, 4, 3, 5, 4, 2, 0];
  const variants = melodicVariations.map(variation => transformMelody(motif, variation, 2));
  assert.equal(new Set(variants.map(notes => notes.join())).size, melodicVariations.length);
  for (const variation of melodicVariations) for (let seed = 0; seed < 26; seed++) {
    for (const source of [motif, [0], [6], [0, 6, 0, 6]]) {
      const notes = transformMelody(source, variation, seed);
      assert.equal(notes.length, source.length);
      assert.ok(notes.every(n => Number.isInteger(n) && n >= 0 && n <= 6));
    }
  }
});

test('new transformations stay playable in every key and mode', () => {
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of Object.keys(modes) as Mode[]) for (const variation of melodicVariations) {
    const self = { ...configureHarmony(createMusician(0), { tonic, mode }, 'fixed'), beat: 16 };
    const decision = realizeStrategy({ self, neighbours: [neighbour(16)], memory: [] }, { ...strategy, variation });
    assert.ok(validDecision(decision));
    const next = applyDecision(self, decision);
    assert.ok(firstBar(next).every(midi => modes[mode].some(interval => (tonic + interval) % 12 === midi % 12)));
    assert.ok(firstBar(next).every(midi => midi >= 72 + tonic && midi <= 83 + tonic));
  }
});

test('explicit theme recall stays exact and cadences still resolve', () => {
  let self = configureForm(createMusician(0), { choice: 'aba', bars: 4 });
  self = advanceForm({ ...self, beat: 128 });
  self = { ...self, beat: 144 };
  const context = { self, neighbours: [neighbour(self.beat)], memory: [] };
  for (const variation of melodicVariations) {
    const decision = realizeStrategy(context, { ...strategy, form: 'aba', themeAction: 'recall', variation });
    assert.deepEqual(decision.motif, self.form!.home.motif);
    assert.deepEqual(decision.rhythm, self.form!.home.rhythm);
    const cadence = { ...self, beat: 176 };
    const developed = realizeStrategy({ ...context, self: cadence }, { ...strategy, form: 'aba', variation });
    assert.equal(firstBar(applyDecision(cadence, developed)).at(-1), 72);
  }
});

test('free development cannot get stuck recalling the opening, while structured returns can', () => {
  for (const self of [createMusician(0), configureForm(createMusician(0), { choice: 'free', bars: 4 })]) {
    assert.deepEqual(responseSchema({ self, neighbours: [], memory: [] }).properties.themeAction.enum, ['develop', 'contrast']);
  }
  const self = configureForm(createMusician(0), { choice: 'aba', bars: 4 });
  assert.deepEqual(responseSchema({ self: { ...self, beat: 128 }, neighbours: [], memory: [] }).properties.themeAction.enum, ['recall', 'develop']);
  const previous = { ...strategy, motif: [0, 2, 4, 2], variation: 'reverse' as const };
  const messages = buildMessages({ self, neighbours: [], memory: [previous] });
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.previousDecisions[0].variation, 'reverse');
  assert.ok(!payload.melodicExperiment.tryVariations.includes('reverse'));
  assert.equal(validStrategy({ ...strategy, variation: 'unknown' }), false);
  assert.ok(validStrategy({ ...strategy, variation: undefined }), 'Older peer messages remain valid.');
});
