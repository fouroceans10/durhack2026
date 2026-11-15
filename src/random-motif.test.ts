import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStartingMotif } from './random-motif';
import { validStartingMotif } from './melody';
import { compose, createOrchestra, seedMusician, createMusician } from './engine';

test('generated openings vary melody and rhythm while remaining playable', () => {
  let seed = 91;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const phrases = Array.from({ length: 200 }, () => generateStartingMotif(undefined, random));
  assert.ok(phrases.every(validStartingMotif));
  assert.ok(phrases.every(p => p.motif.length >= 4 && p.motif.length <= 8 && new Set(p.motif).size > 1 && p.rhythm[0] === 0));
  assert.ok(new Set(phrases.map(p => p.motif.join())).size > 100);
  assert.ok(new Set(phrases.map(p => p.rhythm.join())).size > 100);
  const agents = createOrchestra().map(m => seedMusician(m, phrases[0]));
  assert.deepEqual(agents[0].motif, agents[1].motif);
  assert.notEqual(agents[0].motif, agents[1].motif);
  assert.ok(agents.every(m => Array.from({ length: 16 }, (_, beat) => compose({ ...m, beat })).flat().length > 0));
});

test('reroll cannot repeat the previous phrase even with identical random values', () => {
  const first = generateStartingMotif(undefined, () => .5), before = structuredClone(first);
  const second = generateStartingMotif(first, () => .5);
  assert.notDeepEqual(second, first);
  assert.deepEqual(first, before);
  assert.ok(validStartingMotif(second));
});

test('generated openings enter their second note promptly and sustain through the first entrance gap', () => {
  let seed = 742;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const shapes = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const phrase = generateStartingMotif(undefined, random);
    assert.ok(phrase.rhythm[1] === 1 || phrase.rhythm[1] === 2);
    assert.equal(phrase.durations![0], phrase.rhythm[1]); assert.equal(phrase.articulations![0], 'legato');
    assert.ok(validStartingMotif(phrase)); shapes.add(phrase.rhythm.join());
    const m = seedMusician(createMusician(0), phrase);
    assert.ok(compose(m)[0].duration >= phrase.rhythm[1] * 60 / m.tempo / 4);
    assert.equal(compose({ ...m, beat: phrase.rhythm[1] }).length, 1);
  }
  assert.ok(shapes.size > 100, 'Keeping the first pair connected still permits varied rhythms.');
  const uploaded = { motif: [0, 2], rhythm: [0, 8], durations: [1, 4] as (1 | 4)[], articulations: ['staccato', 'tenuto'] as ('staccato' | 'tenuto')[] };
  const m = seedMusician(createMusician(0), uploaded);
  assert.deepEqual(m.rhythm, uploaded.rhythm); assert.deepEqual(m.durations, uploaded.durations);
});
