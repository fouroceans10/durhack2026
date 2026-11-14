import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMusician, createOrchestra, type Musician } from './engine';
import { buildMessages, LocalBrains, ollamaDecider, realizeStrategy, selectNeighbours, type BrainStatus, type ListeningContext } from './local-llm';
import { validDecision, type MelodyDecision } from './melody';
const phrase = (degree = 5): MelodyDecision => ({ motif: [degree, 4, 2, 1], rhythm: [0, 3, 7, 11], energy: .6, approach: 'counterpoint', interval: 0, respondTo: 'Viola', reason: 'Answer the neighbouring melody with a descending phrase.', form: 'free', gesture: 'plain', themeAction: 'develop', keyChange: 'stay', durations: [2, 3, 4, 4], articulations: ['legato', 'legato', 'normal', 'staccato'] });
const flush = () => new Promise(resolve => setImmediate(resolve));
function played(instrument: number, midi = 69): Musician {
  return { ...createMusician(instrument), beat: 16, recentNotes: [{ step: 15, midi, duration: .3, velocity: .5 }] };
}

test('listening uses actual nearby notes and omits muted, stale and unreachable players', () => {
  const self = played(0), near = played(1), muted = { ...played(2), audible: false }, stale = { ...played(3), beat: 100 };
  const neighbours = selectNeighbours(self, [self, near, muted, stale]);
  assert.deepEqual(neighbours.map(p => p.id), [near.id]);
  const first = buildMessages({ self, neighbours, memory: [] });
  const changed = buildMessages({ self, neighbours: [{ ...near, recentNotes: [{ step: 15, midi: 71, duration: .3, velocity: .5 }] }], memory: [] });
  assert.notDeepEqual(first, changed);
  assert.equal(JSON.parse(first[1].content).neighbours[0].played[0][1], 69);
  assert.ok(selectNeighbours(self, createOrchestra().map(a => played(a.instrument))).length <= 6);
});

test('every agent gets an independent inference call and its own memory', async () => {
  const agents = createOrchestra().map(a => played(a.instrument));
  const contexts: ListeningContext[] = [], statuses = new Map<string, BrainStatus>();
  const brains = new LocalBrains(async context => { contexts.push(context); return phrase(context.self.instrument % 7); },
    id => ({ self: agents.find(a => a.id === id)!, reachable: agents }), (id, status) => statuses.set(id, status),
    { concurrency: 1, intervalMs: 0, timeoutMs: 1000 });
  try {
    brains.tick(agents.map(a => a.id));
    await flush();
    assert.equal(contexts.length, 26);
    assert.equal(new Set(contexts.map(c => c.self.id)).size, 26);
    assert.ok(contexts.every(c => c.memory.length === 0));
    const adopted = agents.map(a => brains.atBar(a));
    assert.ok(adopted.every(a => a.decision && a.motif[0] === a.instrument % 7));
    assert.ok([...statuses.values()].every(s => s.decisions === 1));
    brains.tick([agents[0].id]); await flush();
    assert.deepEqual(contexts[26].memory, [phrase(0)]);
    assert.ok(contexts.slice(1, 26).every(c => c.memory.length === 0));
  } finally { brains.dispose(); }
});

test('queued agents observe the latest notes when inference starts', async () => {
  const a = played(0), b = played(1); let midi = 69;
  let resolveFirst!: (d: MelodyDecision) => void;
  const contexts: ListeningContext[] = [];
  const brains = new LocalBrains(context => { contexts.push(context); return contexts.length === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(phrase()); },
    id => ({ self: id === a.id ? a : b, reachable: [{ ...a, recentNotes: [{ step: 15, midi, duration: .3, velocity: .5 }] }] }), () => {}, { concurrency: 1, intervalMs: 0, timeoutMs: 1000 });
  try {
    brains.tick([a.id, b.id]);
    midi = 71; resolveFirst(phrase()); await flush();
    assert.equal(contexts[1].neighbours[0].recentNotes[0].midi, 71);
  } finally { brains.dispose(); }
});

test('topology changes cancel in-flight decisions and discard ready phrases', async () => {
  const self = played(0), neighbour = played(1);
  let finish!: (d: MelodyDecision) => void, signal!: AbortSignal;
  const brains = new LocalBrains((_, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); },
    () => ({ self, reachable: [neighbour] }), () => {}, { concurrency: 1, intervalMs: 0, timeoutMs: 1000 });
  try {
    brains.tick([self.id]); brains.invalidate(); assert.ok(signal.aborted);
    finish(phrase()); await flush(); assert.equal(brains.atBar(self).decision, undefined);
    brains.tick([self.id]); finish(phrase()); await flush(); brains.invalidate();
    assert.equal(brains.atBar(self).decision, undefined);
  } finally { brains.dispose(); }
});

test('a disappeared neighbour invalidates a pending phrase before playback', async () => {
  const self = played(0); let reachable = [played(1)];
  const brains = new LocalBrains(async () => phrase(), () => ({ self, reachable }), () => {});
  try { brains.tick([self.id]); await flush(); reachable = []; assert.equal(brains.atBar(self).decision, undefined); }
  finally { brains.dispose(); }
});

test('slow and invalid local inference falls back without changing musical state', async () => {
  const self = played(0), states: BrainStatus[] = [];
  const brains = new LocalBrains(() => new Promise(() => {}), () => ({ self, reachable: [] }), (_, s) => states.push(s), { concurrency: 1, intervalMs: 0, timeoutMs: 10 });
  try {
    brains.tick([self.id]); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(states.at(-1)?.phase, 'fallback');
    assert.equal(brains.atBar(self), self);
    assert.equal(validDecision({ ...phrase(), rhythm: [0, 0] }), false);
    assert.equal(validDecision({ ...phrase(), motif: [99] }), false);
    assert.equal(validDecision({ ...phrase(), reason: 'x'.repeat(181) }), false);
  } finally { brains.dispose(); }
});

test('Ollama adapter requests constrained local inference and validates returned JSON', async t => {
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { content: JSON.stringify(phrase()) } }));
  });
  const decide = ollamaDecider('qwen3:0.6b');
  const result = await decide({ self: played(0), neighbours: [played(1)], memory: [] }, new AbortController().signal);
  assert.deepEqual(result, realizeStrategy({ self: played(0), neighbours: [played(1)], memory: [] }, phrase()));
  assert.equal(requests[0].stream, false);
  assert.equal(requests[0].think, false);
  assert.equal(requests[0].model, 'qwen3:0.6b');
  assert.ok(requests[0].format);
  await assert.rejects(ollamaDecider('remote:cloud')({ self: played(0), neighbours: [], memory: [] }, new AbortController().signal));
});

test('model strategy must reference a heard musician and onsets are normalized', async t => {
  const self = played(0), context = { self, neighbours: [played(1)], memory: [] };
  let reply: unknown = { ...phrase(), respondTo: 'Someone outside the partition' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } })));
  const decide = ollamaDecider('qwen3:1.7b');
  await assert.rejects(decide(context, new AbortController().signal), /cannot hear/);
  reply = { ...phrase(), rhythm: [0, 0, 4], durations: [2, 1, 4], articulations: ['legato', 'staccato', 'tenuto'] };
  assert.deepEqual((await decide(context, new AbortController().signal)).rhythm, [0, 4]);
  reply = { ...phrase(), interval: 999 };
  await assert.rejects(decide(context, new AbortController().signal), /validation/);
});

test('the same LLM strategy produces different melodies when the partner plays different notes', () => {
  const self = played(0);
  const first = realizeStrategy({ self, neighbours: [played(1, 69)], memory: [] }, phrase());
  const second = realizeStrategy({ self, neighbours: [played(1, 71)], memory: [] }, phrase());
  assert.notDeepEqual(first.motif, second.motif);
  assert.ok(validDecision(first) && validDecision(second));
});

test('unpitched neighbours influence strategy without inventing harmonic pitches', () => {
  const context = { self: played(0), neighbours: [played(18)], memory: [] };
  const described = JSON.parse(buildMessages(context)[1].content).neighbours[0];
  assert.equal(described.pitched, false);
  assert.equal(described.played[0][1], null);
  assert.equal(described.played[0][2], null);
  assert.ok(validDecision(realizeStrategy(context, { ...phrase(), respondTo: 'Snare drum' })));
});
