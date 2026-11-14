import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMotif, nearestDegree, ANALYSIS_RATE } from './motif-extraction';
import { validStartingMotif } from './melody';
import { applyDecision, compose, createOrchestra, evolve, isOpening, seedMusician, validState } from './engine';
import { isPitched, orchestra } from './orchestra';
import { buildMessages, LocalBrains } from './local-llm';

function recording(notes: number[], gap = .06, leading = .2) {
  const length = .32 + gap;
  const pcm = new Float32Array(Math.ceil((leading + notes.length * length + .2) * ANALYSIS_RATE));
  notes.forEach((midi, index) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let i = 0; i < .32 * ANALYSIS_RATE; i++) {
      const time = i / ANALYSIS_RATE, envelope = Math.min(1, time / .015, (.32 - time) / .02);
      pcm[Math.floor((leading + index * length) * ANALYSIS_RATE) + i] = envelope * (.3 * Math.sin(2 * Math.PI * frequency * time) + .1 * Math.sin(4 * Math.PI * frequency * time));
    }
  });
  return pcm;
}

test('extracts a real PCM melody with leading silence, harmonics and relative entrances', () => {
  const result = extractMotif(recording([60, 64, 67, 65, 62]), ANALYSIS_RATE);
  assert.deepEqual(result.motif, [0, 2, 4, 3, 1]);
  assert.deepEqual(result.notes.map(n => n.midi), [60, 64, 67, 65, 62]);
  assert.equal(result.rhythm[0], 0);
  assert.ok(validStartingMotif(result));
  assert.equal(result.waveform.length, 100);
  assert.ok(result.confidence >= .88);
});

test('separated repeated notes remain separate, and motifs are bounded', () => {
  assert.deepEqual(extractMotif(recording([67, 67, 67]), ANALYSIS_RATE).motif, [4, 4, 4]);
  const result = extractMotif(recording(Array.from({ length: 20 }, (_, i) => [60, 64, 67][i % 3])), ANALYSIS_RATE);
  assert.equal(result.detectedNotes, 20);
  assert.equal(result.motif.length, 12);
  assert.ok(validStartingMotif(result));
});

test('silence, noise, clicks and invalid durations cannot invent a starting melody', () => {
  assert.throws(() => extractMotif(new Float32Array(16000), ANALYSIS_RATE), /No clear melody/);
  let seed = 17;
  const noise = Float32Array.from({ length: 16000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648 * .3; });
  assert.throws(() => extractMotif(noise, ANALYSIS_RATE), /No clear melody/);
  const click = new Float32Array(16000); click[500] = 1;
  assert.throws(() => extractMotif(click, ANALYSIS_RATE), /No clear melody/);
  assert.throws(() => extractMotif(new Float32Array(16000 * 31), ANALYSIS_RATE), /30 seconds/);
  assert.throws(() => extractMotif(new Float32Array(100), ANALYSIS_RATE), /0.25/);
});

test('chromatic pitches are fitted to the shared scale across octaves', () => {
  assert.equal(nearestDegree(60), 0); assert.equal(nearestDegree(72), 0);
  assert.equal(nearestDegree(66), 3); assert.equal(nearestDegree(70), 5);
  assert.deepEqual(extractMotif(recording([66, 70, 73]), ANALYSIS_RATE).motif, [3, 5, 0]);
});

test('every pitched instrument performs the seed in order for two bars before evolution', () => {
  const phrase = { motif: [0, 2, 4, 3, 1], rhythm: [0, 3, 6, 10, 13] };
  const agents = createOrchestra().map(m => seedMusician({ ...m, beat: 100, recentNotes: [{ step: 99, midi: 69, duration: .4, velocity: .5 }] }, phrase));
  for (const agent of agents) {
    assert.equal(agent.beat, 0); assert.deepEqual(agent.recentNotes, []); assert.ok(validState(agent));
    if (isPitched(agent.instrument)) {
      const pitches = phrase.rhythm.map(beat => compose({ ...agent, beat })[0].midi - orchestra[agent.instrument].base);
      assert.deepEqual(pitches, [0, 4, 7, 5, 2]);
      assert.deepEqual(phrase.rhythm.map(step => compose({ ...agent, beat: step + 16 })[0].midi - orchestra[agent.instrument].base), pitches);
    } else assert.deepEqual(agent.rhythm, orchestra[agent.instrument].pattern);
    const peer = { ...agents[5], id: 'neighbour', beat: 16, recentNotes: [{ step: 15, midi: 71, duration: .3, velocity: .5 }] };
    assert.deepEqual(evolve({ ...agent, beat: 16 }, [peer]).motif, phrase.motif);
    assert.notDeepEqual(evolve({ ...agent, beat: 32 }, [peer]).motif, phrase.motif);
    assert.equal(isOpening({ ...agent, beat: 32 }), false);
  }
  assert.notEqual(agents[0].motif, agents[1].motif, 'Agents have independent seed copies');
  const reset = seedMusician(agents[0], null);
  assert.deepEqual(reset.motif, [0, 2, 4, 2]); assert.equal(reset.seeded, undefined);
  assert.throws(() => seedMusician(agents[0], { motif: [99], rhythm: [0] }), /Invalid/);
  assert.equal(validState({ ...agents[0], seeded: 'yes' }), false);
});

test('local inference waits for the opening, then receives its notes and can replace it', async () => {
  let agent = seedMusician(createOrchestra()[0], { motif: [5, 2, 3], rhythm: [0, 4, 8] });
  let calls = 0;
  const decision = { motif: [0, 2, 4, 2], rhythm: [0, 4, 8, 12], energy: .5, interval: 0, approach: 'develop' as const, respondTo: 'self', reason: 'Develop the opening.' };
  const brains = new LocalBrains(async context => {
    calls++; assert.deepEqual(JSON.parse(buildMessages(context)[1].content).self.motif, [5, 2, 3]); return decision;
  }, () => ({ self: agent, reachable: [] }), () => {});
  try {
    brains.tick([agent.id]); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
    assert.equal(applyDecision(agent, decision), agent);
    agent = { ...agent, beat: 32 };
    brains.tick([agent.id]); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
    const adopted = brains.atBar(agent);
    assert.deepEqual(adopted.motif, decision.motif); assert.equal(adopted.seeded, undefined);
  } finally { brains.dispose(); }
});
