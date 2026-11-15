import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMusician, createOrchestra } from './engine';
import { DEFAULT_BRAIN_OPTIONS, LocalBrains, LocalRuntimeError, MAX_CONTEXT_STEPS, type BrainStatus, type ListeningContext } from './local-llm';
import type { MelodyDecision } from './melody';
const decision: MelodyDecision = { motif: [0, 4, 2], rhythm: [0, 4, 8], energy: .5, approach: 'echo', interval: 0, reason: 'A fresh response.', respondTo: 'self' };
const flush = () => new Promise(resolve => setImmediate(resolve));
const played = (instrument = 0) => ({ ...createMusician(instrument), beat: 16 });

test('default cadence revisits an accepted phrase after two seconds and still adopts only at bars', async t => {
  let now = 100000, self = played(); t.mock.method(Date, 'now', () => now);
  const contexts: ListeningContext[] = [];
  const brains = new LocalBrains(async c => { contexts.push(c); return decision; }, () => ({ self, reachable: [] }), () => {});
  try {
    brains.tick([self.id]); await flush();
    assert.equal(brains.atBar({ ...self, beat: 17 }).decision, undefined);
    self = brains.atBar(self);
    now += 1999; brains.tick([self.id]); await flush(); assert.equal(contexts.length, 1);
    now++; brains.tick([self.id]); await flush(); assert.equal(contexts.length, 2);
    assert.deepEqual(contexts[1].memory, [decision]); assert.equal(DEFAULT_BRAIN_OPTIONS.intervalMs, 2000);
  } finally { brains.dispose(); }
});

test('four bounded parallel requests serve the whole orchestra before revisiting early voices', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  const agents = createOrchestra().map(m => played(m.instrument)), started: string[] = [];
  const jobs: { id: string; finish: (d: MelodyDecision) => void }[] = [];
  let active = 0, peak = 0;
  const brains = new LocalBrains(c => { started.push(c.self.id); peak = Math.max(peak, ++active);
    return new Promise<MelodyDecision>(resolve => jobs.push({ id: c.self.id, finish: d => { active--; resolve(d); } })); },
  id => ({ self: agents.find(m => m.id === id)!, reachable: [] }), () => {});
  try {
    brains.tick(agents.map(m => m.id)); assert.equal(started.length, 4);
    while (started.length < 26) {
      const batch = jobs.splice(0); batch.forEach(j => j.finish(decision)); await flush();
      for (const job of batch) { const i = agents.findIndex(m => m.id === job.id); agents[i] = brains.atBar(agents[i]); }
      now += 2100; brains.tick(agents.map(m => m.id));
    }
    assert.equal(new Set(started.slice(0, 26)).size, 26);
    assert.equal(peak, 4); assert.ok(active <= 4);
    jobs.splice(0).forEach(j => j.finish(decision)); await flush();
  } finally { brains.dispose(); jobs.splice(0).forEach(j => j.finish(decision)); await flush(); }
});

test('editing cadence preserves history and immediately updates the remaining wait', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now); let self = played();
  const contexts: ListeningContext[] = [];
  const brains = new LocalBrains(async c => { contexts.push(c); return decision; }, () => ({ self, reachable: [] }), () => {}, { concurrency: 1, intervalMs: 12000, timeoutMs: 1000 });
  try {
    brains.tick([self.id]); await flush(); self = brains.atBar(self);
    now += 1500; brains.setIntervalMs(1000); brains.tick([self.id]); await flush(); assert.equal(contexts.length, 2);
    self = brains.atBar(self); brains.setIntervalMs(8000);
    now += 7999; brains.tick([self.id]); await flush(); assert.equal(contexts.length, 2);
    now++; brains.tick([self.id]); await flush(); assert.equal(contexts.length, 3);
    assert.equal(contexts[2].memory.length, 2);
    assert.throws(() => brains.setIntervalMs(NaN)); assert.throws(() => brains.setIntervalMs(-1));
  } finally { brains.dispose(); }
});

test('changing cadence cannot bypass failure backoff', async t => {
  let now = 100000, calls = 0; t.mock.method(Date, 'now', () => now); const self = played();
  const brains = new LocalBrains(async () => { calls++; if (calls > 1) throw new Error('Offline'); return decision; }, () => ({ self, reachable: [] }), () => {});
  try {
    brains.tick([self.id]); await flush(); brains.atBar(self);
    now += 2000; brains.tick([self.id]); await flush(); assert.equal(calls, 2);
    brains.setIntervalMs(0);
    now += 4000; brains.tick([self.id]); await flush(); assert.equal(calls, 2);
    now += 1000; brains.tick([self.id]); await flush(); assert.equal(calls, 3);
  } finally { brains.dispose(); }
});

test('old listening context is dropped at completion and playback without delaying fresh work', async () => {
  let self = played(), finish!: (d: MelodyDecision) => void, calls = 0; const statuses: BrainStatus[] = [];
  const brains = new LocalBrains(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => ({ self, reachable: [] }), (_, s) => statuses.push(s));
  try {
    brains.tick([self.id]); self = { ...self, beat: self.beat + MAX_CONTEXT_STEPS + 16 }; finish(decision); await flush();
    assert.equal(brains.atBar(self).decision, undefined); assert.equal(statuses.at(-1)?.phase, 'listening');
    brains.tick([self.id]); assert.equal(calls, 2); finish(decision); await flush();
    self = { ...self, beat: self.beat + MAX_CONTEXT_STEPS + 16 };
    assert.equal(brains.atBar(self).decision, undefined);
    brains.tick([self.id]); assert.equal(calls, 3);
  } finally { brains.dispose(); finish(decision); await flush(); }
});

test('malformed decisions delay only their agent; runtime failures back off the shared queue', async t => {
  let now = 100000; t.mock.method(Date, 'now', () => now);
  for (const shared of [false, true]) {
    const agents = [played(0), played(1)], calls: string[] = [];
    const brains = new LocalBrains(async c => {
      calls.push(c.self.id);
      if (c.self.instrument === 0) throw shared ? new LocalRuntimeError('Offline') : new Error('Malformed rhythm');
      return decision;
    }, id => ({ self: agents.find(m => m.id === id)!, reachable: [] }), () => {}, { concurrency: 1, intervalMs: 2000, timeoutMs: 1000 });
    try {
      brains.tick(agents.map(m => m.id)); await flush();
      assert.equal(calls.length, shared ? 1 : 2);
      if (shared) {
        now += 2999; brains.tick(agents.map(m => m.id)); await flush(); assert.equal(calls.length, 1);
        now++; brains.tick(agents.map(m => m.id)); await flush(); assert.deepEqual(calls, ['0', '1']);
      }
      assert.equal(brains.atBar(agents[1]).decision?.reason, decision.reason);
    } finally { brains.dispose(); }
  }
});
