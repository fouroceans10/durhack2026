import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDecision, compose, createMusician, createOrchestra, evolve, recordPerformance, validState, type Musician } from './engine';
import { orchestra, sections } from './orchestra';

test('the orchestra has one independent agent for every instrument across all five sections', () => {
  const agents = createOrchestra();
  assert.equal(agents.length, 26);
  assert.equal(new Set(orchestra.map(p => p.name)).size, agents.length);
  assert.equal(new Set(agents.map(a => a.id)).size, agents.length);
  assert.equal(new Set(orchestra.map(p => p.section)).size, sections.length);
  agents[0].motif.push(6);
  assert.ok(agents.slice(1).every(a => !a.motif.includes(6)));
  for (const section of sections) {
    const sectionAgents = agents.filter(a => orchestra[a.instrument].section === section);
    assert.equal(new Set(sectionAgents.map(a => a.group)).size, 2, `${section} is represented on both partition branches`);
  }
});

for (let instrument = 0; instrument < orchestra.length; instrument++) {
  test(`${orchestra[instrument].name} composes finite notes in its own register and continues in isolation`, () => {
    let agent = createMusician(instrument), sounded = 0;
    for (let i = 0; i < 256; i++) {
      for (const note of compose(agent)) {
        sounded++;
        assert.ok(Number.isFinite(note.midi) && note.midi >= orchestra[instrument].base && note.midi <= orchestra[instrument].base + 24);
        assert.ok(note.duration > 0 && note.duration < 3);
        assert.ok(note.velocity > 0 && note.velocity <= 1);
      }
      agent = evolve(agent, []);
      assert.ok(validState(agent));
    }
    assert.ok(sounded > 0, 'Instrument must produce audible events');
    assert.equal(agent.beat, 256);
  });
}

test('higher peer energy changes an individual instrument’s musical decisions', () => {
  const quiet = { ...createMusician(0), energy: .3 };
  let loud = { ...quiet };
  const peers = createOrchestra().slice(1).map(a => ({ ...a, energy: .9, recentNotes: [{ midi: 60, step: 0, duration: .3, velocity: .9 }] }));
  for (let i = 0; i < 32; i++) loud = evolve(loud, peers);
  const countNotes = (m: Musician) => Array.from({ length: 16 }, (_, beat) => compose({ ...m, beat }).length).reduce((a, b) => a + b, 0);
  assert.ok(countNotes(loud) > countNotes(quiet));
});

test('all partitioned instruments develop locally and tempos converge without reading unheard motifs', () => {
  let agents = createOrchestra().map(a => ({ ...a, tempo: a.group ? 135 : 95, motif: a.group ? [5, 6, 1] : [0, 2, 4] }));
  for (let step = 0; step < 64; step++) {
    agents = agents.map(a => evolve(a, agents.filter(p => p.group === a.group)));
  }
  assert.ok(agents.every(a => a.beat === 64));
  assert.ok(agents.every(a => a.motif.length === 3), 'Isolated branches do not receive the other motif');
  const spreadBefore = Math.max(...agents.map(a => a.tempo)) - Math.min(...agents.map(a => a.tempo));
  for (let step = 0; step < 128; step++) agents = agents.map(a => {
    const next = evolve(a, agents);
    const hidden = evolve(a, agents.map(p => ({ ...p, motif: [6, 6, 6] })));
    assert.deepEqual(next.motif, hidden.motif, 'Unperformed peer motifs cannot influence local development');
    return next;
  });
  const spreadAfter = Math.max(...agents.map(a => a.tempo)) - Math.min(...agents.map(a => a.tempo));
  assert.ok(spreadAfter < spreadBefore / 4);
  assert.ok(agents.every(a => a.motif.length === 3));
});

test('peer validation supports the whole catalog and rejects invalid instrument IDs and malformed state', () => {
  for (const a of createOrchestra()) assert.ok(validState(a));
  for (const instrument of [-1, .5, orchestra.length, NaN]) {
    assert.equal(validState({ ...createMusician(0), instrument }), false);
    assert.throws(() => createMusician(instrument), RangeError);
  }
  for (const change of [{ id: '' }, { tempo: NaN }, { motif: [999] }, { motif: [] }, { energy: 2 }, { beat: -1 }]) {
    assert.equal(validState({ ...createMusician(0), ...change }), false);
  }
});

test('agent evolution is deterministic and leaves peer state untouched', () => {
  const agents = createOrchestra(), before = structuredClone(agents);
  assert.deepEqual(evolve(agents[0], agents), evolve(agents[0], agents));
  assert.deepEqual(agents, before);
});


test('melodic fallback responds to performed notes, not only a peer’s intended motif', () => {
  const self = { ...createMusician(0), beat: 15 };
  const peer = { ...createMusician(1), beat: 16, recentNotes: [{ step: 15, midi: 69, duration: .4, velocity: .5 }] };
  const responseA = evolve(self, [peer]);
  const responseB = evolve(self, [{ ...peer, recentNotes: [{ step: 15, midi: 71, duration: .4, velocity: .5 }] }]);
  assert.notDeepEqual(responseA.motif, responseB.motif);
  assert.ok(responseA.motif.includes(5));
  assert.ok(responseB.motif.includes(6));
  assert.deepEqual(evolve(self, [{ ...peer, audible: false }]).motif, self.motif);
});

test('validated model phrases change actual notes at bar boundaries and survive peer evolution', () => {
  const self = { ...createMusician(0), beat: 16 };
  const decision = { motif: [5, 4, 2, 1], rhythm: [0, 3, 7, 11], energy: .7, approach: 'counterpoint' as const, interval: 0, respondTo: 'Flute', reason: 'Answer the flute with a descending phrase.' };
  const next = applyDecision(self, decision);
  assert.notDeepEqual(compose(next), compose(self));
  assert.deepEqual(compose({ ...next, beat: 18 }), [], 'Model rests are preserved');
  assert.equal(compose({ ...next, beat: 19 }).length, 1, 'Model onsets reach the audio engine');
  assert.deepEqual(evolve(next, createOrchestra()).motif, decision.motif);
  assert.equal(applyDecision({ ...self, beat: 17 }, decision).decision, undefined);
  assert.equal(applyDecision(self, { ...decision, motif: [99] }).decision, undefined);
});

test('performance history is bounded, ages out, and excludes muted sound', () => {
  let agent = createMusician(0);
  for (let beat = 0; beat < 200; beat++) agent = recordPerformance({ ...agent, beat }, [{ midi: 72, duration: .2, velocity: .5 }], true);
  assert.equal(agent.recentNotes.length, 24);
  const muted = recordPerformance({ ...agent, beat: 250 }, [{ midi: 75, duration: .2, velocity: .5 }], false);
  assert.deepEqual(muted.recentNotes, []);
  assert.equal(muted.audible, false);
  assert.equal(validState({ ...agent, recentNotes: [{ midi: NaN }] }), false);
});


test('a new model phrase starts at its first note, even late in a performance', () => {
  const decision = { motif: [5, 4, 2, 1, 0], rhythm: [0, 3, 7, 11], energy: .6, interval: 0, approach: 'echo' as const, respondTo: 'Flute', reason: 'Echo the flute.' };
  const next = applyDecision({ ...createMusician(0), beat: 48 }, decision);
  assert.equal(compose(next)[0].midi, 81);
  assert.equal(compose({ ...next, beat: 51 })[0].midi, 79);
});
