import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compose, createOrchestra, evolve, validState, type Musician } from './engine';
import { LocalBrains, type ListeningContext } from './local-llm';
import { assignPartition, canExchange, groupLetter, partitionGroup, reachableMusicians, validPartition, type PartitionPlan } from './partitions';
import { orchestra, sections } from './orchestra';
import type { MelodyDecision } from './melody';

const plans: PartitionPlan[] = [
  { kind: 'mixed' }, { kind: 'instrument', instrument: 5 }, { kind: 'section', section: 'Strings' },
  { kind: 'sections' }, { kind: 'solo' }, { kind: 'custom', instruments: [0, 5, 19, 24] },
];

test('presets produce 13/13, 1/25, section, solo and custom groups', () => {
  const sizes = plans.map(plan => {
    const groups = new Map<number, number>();
    for (const m of createOrchestra()) groups.set(partitionGroup(plan, m.instrument), (groups.get(partitionGroup(plan, m.instrument)) ?? 0) + 1);
    return [...groups].sort(([a], [b]) => a - b).map(([, count]) => count);
  });
  assert.deepEqual(sizes, [[13, 13], [1, 25], [4, 22], [4, 8, 5, 6, 3], Array(26).fill(1), [4, 22]]);
});

test('every split is symmetric and only its actual members can exchange ideas', () => {
  for (const plan of plans) {
    assert.ok(validPartition(plan));
    const players = assignPartition(createOrchestra(), plan);
    for (const a of players) for (const b of players) {
      assert.ok(validState(a));
      assert.equal(canExchange(plan, a, b), a.id !== b.id && a.group === b.group);
      assert.equal(canExchange(plan, a, b), canExchange(plan, b, a));
    }
  }
  const players = createOrchestra();
  assert.equal(reachableMusicians(players[0], players, null).length, 25);
  assert.equal(canExchange({ kind: 'solo' }, players[0], { ...players[0], id: 'another-violin' }), false);
});

test('partition membership cannot be spoofed by received group numbers', () => {
  const players = createOrchestra();
  for (const section of sections) {
    const plan: PartitionPlan = { kind: 'section', section };
    const self = players.find(p => orchestra[p.instrument].section === section)!;
    const neighbours = reachableMusicians(self, players.map(p => ({ ...p, group: self.group })), plan);
    assert.ok(neighbours.every(p => orchestra[p.instrument].section === section));
    assert.ok(neighbours.every(p => p.group === 0), 'Musical drift uses the locally applied group');
  }
});

test('empty and full custom groups and out-of-range group numbers are rejected', () => {
  for (const instruments of [[], orchestra.map((_, i) => i), [0, 0], [-1], [26], [1.5]]) {
    assert.equal(validPartition({ kind: 'custom', instruments }), false);
  }
  assert.equal(validPartition({ kind: 'instrument', instrument: 26 }), false);
  assert.equal(validPartition({ kind: 'section', section: 'Unknown' as typeof sections[number] }), false);
  for (const group of [-1, 26, 1.5, NaN]) assert.equal(validState({ ...createOrchestra()[0], group }), false);
  assert.equal(groupLetter(25), 'Z');
});

test('applying, replacing and healing a partition preserve musical history and playback', () => {
  const original = createOrchestra().map(m => ({ ...m, beat: 48, motif: [5, 2, 3], recentNotes: [{ midi: 69, step: 47, duration: .2, velocity: .5 }] }));
  const before = structuredClone(original);
  let players: Musician[] = original;
  for (const plan of [...plans, null]) {
    players = assignPartition(players, plan);
    for (const [i, p] of players.entries()) {
      assert.equal(p.beat, 48);
      assert.deepEqual(p.motif, original[i].motif);
      assert.deepEqual(p.recentNotes, original[i].recentNotes);
      assert.equal(p.audible, true);
      assert.ok(validState(evolve(p, reachableMusicians(p, players, plan))));
      assert.ok(Array.from({ length: 16 }, (_, beat) => compose({ ...p, beat: 64 + beat })).flat().length > 0);
    }
  }
  assert.deepEqual(original, before);
});

test('an isolated instrument cannot respond to hidden notes and hears fresh notes after healing', () => {
  const [self, peer] = createOrchestra();
  const beforeBar = { ...self, beat: 15 };
  const played = { ...peer, beat: 16, recentNotes: [{ midi: 71, step: 15, duration: .2, velocity: .5 }] };
  const plan: PartitionPlan = { kind: 'instrument', instrument: self.instrument };
  assert.deepEqual(evolve(beforeBar, reachableMusicians(beforeBar, [played], plan)).motif, self.motif);
  assert.notDeepEqual(evolve(beforeBar, reachableMusicians(beforeBar, [played], null)).motif, self.motif);
});

test('changing a partition cancels inference based on old neighbours and starts fresh context', async () => {
  const players = createOrchestra().slice(0, 2).map(p => ({ ...p, beat: 16, recentNotes: [{ midi: 69, step: 15, duration: .2, velocity: .5 }] }));
  let plan: PartitionPlan | null = null;
  const contexts: ListeningContext[] = [], signals: AbortSignal[] = [], finish: ((d: MelodyDecision) => void)[] = [];
  const brains = new LocalBrains((context, signal) => { contexts.push(context); signals.push(signal); return new Promise(resolve => finish.push(resolve)); },
    () => ({ self: players[0], reachable: reachableMusicians(players[0], players, plan) }), () => {});
  const decision: MelodyDecision = { motif: [5, 2, 3], rhythm: [0, 4, 8], energy: .6, approach: 'echo', interval: 0, respondTo: 'Viola', reason: 'Old neighbour.' };
  try {
    brains.tick([players[0].id]);
    assert.equal(contexts[0].neighbours.length, 1);
    plan = { kind: 'instrument', instrument: 0 }; brains.invalidate();
    assert.equal(signals[0].aborted, true);
    finish[0](decision); await new Promise(resolve => setImmediate(resolve));
    assert.equal(brains.atBar(players[0]).decision, undefined);
    brains.tick([players[0].id]);
    assert.deepEqual(contexts[1].neighbours, []);
  } finally { brains.dispose(); finish.forEach(resolve => resolve(decision)); }
});
